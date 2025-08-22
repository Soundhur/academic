/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Chat, Type, GenerateContentResponse } from "@google/genai";
import { marked } from 'marked';

// --- AI Service Initialization ---
const API_KEY = process.env.API_KEY;
let ai: GoogleGenAI | null = null;
let isAiEnabled = false;

if (API_KEY) {
    try {
        ai = new GoogleGenAI({ apiKey: API_KEY });
        isAiEnabled = true;
    } catch (e) {
        console.error("Failed to initialize GoogleGenAI. AI features will be disabled.", e);
        ai = null;
    }
} else {
    console.warn("`process.env.API_KEY` is not set. AI features will be disabled.");
}

// --- DATA STRUCTURES & CONSTANTS ---
interface Period {
    subject: string;
    faculty?: string;
    type?: 'break' | 'class' | 'common';
}
interface TimetableEntry {
    id: string;
    department: string;
    year: string;
    day: string;
    timeIndex: number;
    subject: string;
    type: 'break' | 'class' | 'common';
    faculty?: string;
    originalFaculty?: string; // For substitutions
    room?: string;
}
interface LeaveRequest {
    id: string;
    facultyId: string;
    facultyName: string;
    timetableEntryId: string;
    day: string;
    timeIndex: number;
    status: 'pending' | 'approved' | 'rejected';
    aiSuggestion?: string;
    reason?: string; // Optional reason for leave
    timestamp: number; // For activity feed
}
interface Announcement {
    id: string;
    title: string;
    content: string;
    author: string; // e.g., "Admin", "HOD (CSE)"
    timestamp: number;
    targetRole: 'all' | 'student' | 'faculty';
    targetDept: 'all' | 'CSE' | 'ECE' | 'EEE' | 'MCA' | 'AI&DS' | 'CYBERSECURITY' | 'MECHANICAL' | 'TAMIL' | 'ENGLISH' | 'MATHS' | 'LIB' | 'NSS' | 'NET';
}
interface GroundingChunk {
    web?: {
        uri?: string;
        title?: string;
    };
}
interface ChatMessage {
    id: string;
    role: 'user' | 'model' | 'tool';
    text: string;
    isError?: boolean;
    sources?: GroundingChunk[];
    toolResult?: any; // To hold the result of a tool call
}
interface BriefingData {
    localSummary: string;
    transportAdvisory: {
        status: string;
        severity: 'low' | 'medium' | 'high';
    };
    educationTrends: { title: string; url: string; }[];
}


type DaySchedule = Period[];
type TimetableData = Record<string, Record<string, DaySchedule[]>>;
type UserRole = 'student' | 'faculty' | 'hod' | 'admin' | 'class advisor';
type AppView = 'dashboard' | 'timetable' | 'manage' | 'settings' | 'auth' | 'approvals' | 'announcements' | 'studentDirectory' | 'security' | 'userManagement';
interface ManageFormData {
    department: string;
    year: string;
    day: string;
    timeIndex: number;
    subject: string;
    type: 'break' | 'class' | 'common';
    faculty?: string;
    room?: string;
}
interface User {
    id: string;
    name: string;
    password?: string;
    role: UserRole;
    dept: string;
    year?: string;
    status: 'active' | 'pending_approval' | 'rejected';
    aiAssessment?: string;
    aiSummary?: string;
    specialization?: string[]; // For faculty
    grades?: { subject: string; score: number }[]; // For students
    attendance?: { present: number; total: number }; // For students
    isLocked?: boolean;
    officeHours?: { day: string, time: string }[];
    hasCompletedOnboarding?: boolean; // For new user guide
}
interface ResourceRequest {
    id: string;
    userId: string;
    requestText: string;
    status: 'pending' | 'approved' | 'rejected';
    timestamp: number;
    aiRecommendation?: string;
}
interface AppNotification {
    id: string;
    message: string;
    type: 'info' | 'success' | 'error' | 'warning';
}

interface AuditLogEntry {
    id: string;
    timestamp: number;
    userId: string;
    action: string;
    ip: string;
    status: 'success' | 'failure' | 'info';
    details?: string;
}

interface SecurityAlert {
    id: string;
    type: 'Anomaly' | 'DrillResult' | 'Threat';
    title: string;
    description: string;
    timestamp: number;
    severity: 'low' | 'medium' | 'high' | 'critical';
    relatedUserId?: string;
    isResolved: boolean;
    responsePlan?: {
        containment: string;
        investigation: string;
        recovery: string;
        recommendedAction: 'LOCK_USER' | 'MONITOR' | 'NONE';
    };
}

interface Deadline {
    id: string;
    title: string;
    dueDate: number;
    audience: ('all' | UserRole)[];
}

interface ScheduleConflict {
    type: 'Faculty' | 'Class' | 'Room';
    identifier: string;
    entries: TimetableEntry[];
    description: string;
}

interface OnboardingStep {
    target: string;
    content: string;
}


const DEPARTMENTS = ["CSE", "ECE", "EEE", "MCA", "AI&DS", "CYBERSECURITY", "MECHANICAL", "TAMIL", "ENGLISH", "MATHS", "LIB", "NSS", "NET"];
const YEARS = ["I", "II", "III", "IV"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const TIME_SLOTS_DEFAULT = [
    "9:00 - 9:50",
    "9:50 - 10:35",
    "10:35 - 10:50",
    "10:50 - 11:35",
    "11:35 - 12:20",
    "12:20 - 1:05",
    "1:05 - 2:00",
    "2:00 - 2:50",
    "2:50 - 3:40",
    "3:40 - 4:30"
];

const APP_VIEWS_CONFIG: Record<AppView, { title: string; icon: keyof typeof Icons; roles: UserRole[] }> = {
    dashboard: { title: "Dashboard", icon: "dashboard", roles: ['student', 'faculty', 'hod', 'admin', 'class advisor'] },
    timetable: { title: "Timetable", icon: "timetable", roles: ['student', 'faculty', 'hod', 'admin', 'class advisor'] },
    studentDirectory: { title: "Student Directory", icon: "users", roles: ['faculty', 'hod', 'class advisor', 'admin'] },
    approvals: { title: "Approvals", icon: "approvals", roles: ['hod', 'admin'] },
    announcements: { title: "Announcements", icon: "announcement", roles: ['student', 'faculty', 'hod', 'admin', 'class advisor'] },
    manage: { title: "Manage Timetable", icon: "edit", roles: ['admin'] },
    userManagement: { title: "User Management", icon: "users", roles: ['admin'] },
    security: { title: "Security Center", icon: "security", roles: ['admin'] },
    settings: { title: "Settings", icon: "settings", roles: ['admin'] },
    auth: { title: "Authentication", icon: "login", roles: [] },
};


// --- UTILITY FUNCTIONS ---
const uuidv4 = () => crypto.randomUUID();

const getRelativeTime = (timestamp: number) => {
    const now = new Date().getTime();
    const seconds = Math.floor((now - timestamp) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " years ago";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " months ago";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " days ago";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " hours ago";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + " minutes ago";
    return "Just now";
};

// --- ICONS ---
const Icons = {
    logo: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L1 9l4 1.5V17a1 1 0 001 1h12a1 1 0 001-1v-6.5L23 9z"></path></svg>,
    home: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path></svg>,
    dashboard: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 012-2h2a2 2 0 012 2v6m-6 0h6M4 6.342A5.965 5.965 0 017.29 4.25a5.965 5.965 0 017.42 0 5.965 5.965 0 013.29 2.092m-13.9.002A5.965 5.965 0 014 6.342m16 0a5.965 5.965 0 01-3.29 2.092m-13.9-.002a5.965 5.965 0 013.29-2.092"></path></svg>,
    timetable: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>,
    edit: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>,
    settings: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066 2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>,
    chatbot: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>,
    send: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.707l-3-3a1 1 0 00-1.414 1.414L10.586 9H7a1 1 0 100 2h3.586l-1.293 1.293a1 1 0 101.414 1.414l3-3a1 1 0 000-1.414z" clipRule="evenodd"></path></svg>,
    editPencil: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z"></path><path fillRule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clipRule="evenodd"></path></svg>,
    delete: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd"></path></svg>,
    sun: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>,
    moon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>,
    close: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>,
    menu: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>,
    add: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd"></path></svg>,
    approvals: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>,
    announcement: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-2.236 9.168-5.584C18.354 1.832 18 3.65 18 5a6 6 0 01-9.372 5.122L5.436 13.683z"></path></svg>,
    security: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.286zm0 13.036h.008v.008h-.008v-.008z"></path></svg>,
    users: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>,
    login: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>,
    microphone: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8h-1a6 6 0 11-12 0H3a7.001 7.001 0 006 6.93V17H7a1 1 0 100 2h6a1 1 0 100-2h-2v-2.07z" clipRule="evenodd"></path></svg>,
    check: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"></path></svg>,
    x: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.693a1 1 0 010-1.414z" clipRule="evenodd"></path></svg>,
    lightbulb: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path></svg>,
    location: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>,
    transport: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6.115 5.19l.319 1.913A6 6 0 008.11 10.36L9.75 12l-.387.775c-.217.433-.132.956.21 1.298l1.348 1.348c.21.21.329.497.329.795v1.089c0 .426.24.815.622 1.006l.153.076c.473.236.884.646.884 1.154v.643c0 .621-.504 1.125-1.125 1.125H9.097c-.621 0-1.125-.504-1.125-1.125v-.643c0-.508.411-.918.884-1.154l.153-.076c.382-.191.622-.58.622-1.006v-1.089c0-.298.119-.585.329-.795l1.348-1.348c.342-.342.427-.865.21-1.298L9.75 12l-1.64-1.64A6 6 0 006.115 5.19zM12 12h3.75M12 9h3.75M12 15h3.75M4.5 12H6m-1.5 6H6m-1.5-12H6m12 12h1.5m-1.5-6h1.5m-1.5-6h1.5M12 6.75v.007v.008v.007v.008v.007v.008H12z"></path></svg>,
    education: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0l-.332.877m1.699-2.886c.262-.28.58-.515.92-.702m7.854 1.486c.34-.187.678-.398 1.02-.609m-7.854 1.485l-1.699-2.886m1.699 2.886a25.234 25.234 0 001.396-.282m-1.396.282c.262-.28.58-.515.92-.702m-11.082 2.886c.262-.28.58-.515.92-.702"></path></svg>,
    warning: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" ><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"></path></svg>,
    checkCircle: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
    shieldCheck: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.745 3.745 0 013.296-1.043A3.745 3.745 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.745 3.745 0 011.043 3.296A3.745 3.745 0 0121 12z" /></svg>,
    shieldExclamation: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>,
    clipboardList: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75c0-.231-.035-.454-.1-.664M6.75 7.5h1.5v.75h-1.5v-.75zM6.75 12h1.5v.75h-1.5v-.75zM6.75 16.5h1.5v.75h-1.5v-.75zM4.5 6.108a2.25 2.25 0 012.25-2.25h3.812a48.424 48.424 0 011.123.08c1.131.094 1.976 1.057 1.976 2.192v12.284c0 1.135-.845 2.098-1.976 2.192a48.424 48.424 0 01-1.123.08H6.75a2.25 2.25 0 01-2.25-2.25V6.108z" /></svg>,
    lock: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>,
    guardian: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 2.25c.392 0 .771.045 1.141.131l.314.074c1.13 1.26 2.003 2.74 2.536 4.387.533 1.647.809 3.42.809 5.242a9.75 9.75 0 01-1.222 4.793l-.15.275a2.25 2.25 0 01-3.95 0l-.15-.275a9.75 9.75 0 01-1.222-4.793c0-1.822.276-3.595.81-5.242.532-1.647 1.405-3.127 2.536-4.387l.314-.074A5.92 5.92 0 0112 2.25zM12 2.25c-.392 0-.771.045-1.141.131l-.314.074c-1.13 1.26-2.003 2.74-2.536 4.387-.533 1.647-.809 3.42-.809 5.242a9.75 9.75 0 001.222 4.793l.15.275a2.25 2.25 0 003.95 0l.15-.275a9.75 9.75 0 001.222-4.793c0-1.822-.276-3.595-.81-5.242-.532-1.647-1.405-3.127-2.536-4.387l-.314-.074A5.92 5.92 0 0012 2.25zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zM12 15.75a.75.75 0 100-1.5.75.75 0 000 1.5z"></path></svg>,
    calendarDays: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0h18M-4.5 12h22.5" /></svg>,
    academicCap: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.437 60.437 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0l-.332.877m1.699-2.886c.262-.28.58-.515.92-.702" /></svg>,
};

// --- DEMO DATA & INITIALIZATION ---
const createInitialState = <T,>(key: string, defaultValue: T): T => {
    try {
        const storedValue = localStorage.getItem(key);
        if (storedValue) {
            return JSON.parse(storedValue);
        }
    } catch (error) {
        console.error(`Error reading from localStorage for key "${key}":`, error);
    }
    return defaultValue;
};
const usePersistedState = <T,>(key: string, defaultValue: T): [T, React.Dispatch<React.SetStateAction<T>>] => {
    const [state, setState] = useState<T>(() => createInitialState(key, defaultValue));

    useEffect(() => {
        try {
            localStorage.setItem(key, JSON.stringify(state));
        } catch (error) {
            console.error(`Error writing to localStorage for key "${key}":`, error);
        }
    }, [key, state]);

    return [state, setState];
};

const INITIAL_USERS: User[] = [
    { id: 'hod-jane-smith', name: 'Jane Smith', password: 'password', role: 'hod', dept: 'CSE', status: 'active', specialization: ['AI/ML', 'Data Structures'], officeHours: [{day: 'Monday', time: '2:00 PM - 3:00 PM'}] },
    { id: 'advisor-anitha-m', name: 'Mrs. ANITHA M', password: 'password', role: 'class advisor', dept: 'CSE', year: 'II', status: 'active', specialization: ['Data Science', 'Web Technologies'] },
    { id: 'advisor-deepak-mr', name: 'Mr. Deepak', password: 'password', role: 'class advisor', dept: 'CSE', year: 'IV', status: 'active', specialization: ['Advanced Algorithms', 'Compiler Design'] },
    { id: 'faculty-yuvasri', name: 'Ms. YUVASRI', password: 'password', role: 'faculty', dept: 'MATHS', status: 'active', specialization: ['Discrete Mathematics'] },
    { id: 'faculty-ranjani-j', name: 'Ms. RANJANI J', password: 'password', role: 'faculty', dept: 'ECE', status: 'active', specialization: ['Digital Principles', 'Computer Organization'] },
    { id: 'faculty-soundhur', name: 'Mr. SOUNDHUR', password: 'password', role: 'faculty', dept: 'CSE', status: 'active', specialization: ['Data Structures'] },
    { id: 'faculty-myshree-b', name: 'Ms. MYSHREE B', password: 'password', role: 'faculty', dept: 'CSE', status: 'active', specialization: ['Object Oriented Programming'] },
    { id: 'faculty-chithambaram', name: 'Mr. CHITHAMBARAM', password: 'password', role: 'faculty', dept: 'NSS', status: 'active', specialization: ['NSS Coordinator'] },
    { id: 'student-alice', name: 'Alice', password: 'password', role: 'student', dept: 'CSE', year: 'II', status: 'active', grades: [{ subject: 'Data Structures', score: 85 }, {subject: 'AI/ML', score: 91}], attendance: { present: 70, total: 75 } },
    { id: 'student-bob', name: 'Bob', password: 'password', role: 'student', dept: 'ECE', year: 'II', status: 'active', grades: [{ subject: 'Digital Circuits', score: 92 }], attendance: { present: 68, total: 75 } },
    { id: 'pending-user', name: 'Pending User', password: 'password', role: 'faculty', dept: 'EEE', status: 'pending_approval' },
];

const INITIAL_ANNOUNCEMENTS: Announcement[] = [
    { id: 'ann-1', title: "Mid-term Examinations Schedule", content: "The mid-term examinations for all departments will commence from the 15th of next month. Detailed schedule will be shared shortly.", author: "Admin", timestamp: new Date().getTime() - 86400000, targetRole: 'all', targetDept: 'all' },
    { id: 'ann-2', title: "Project Submission Deadline (CSE)", content: "Final year CSE students are reminded that the project submission deadline is this Friday.", author: "HOD (CSE)", timestamp: new Date().getTime() - 172800000, targetRole: 'student', targetDept: 'CSE' }
];

const INITIAL_TIMETABLE_ENTRIES: TimetableEntry[] = [
    // --- Common Breaks/Lunch for all ---
    ...DAYS.flatMap(day => [
        { id: uuidv4(), department: 'all', year: 'all', day, timeIndex: 2, subject: 'Break', type: 'break' as const },
        { id: uuidv4(), department: 'all', year: 'all', day, timeIndex: 6, subject: 'Lunch', type: 'break' as const }
    ]),
    
    // --- CSE II Year Schedule ---
    // Monday
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Monday', timeIndex: 1, subject: 'OOPS', type: 'class' as const, faculty: 'Ms. MYSHREE B', room: 'A212' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Monday', timeIndex: 3, subject: 'FDS', type: 'class' as const, faculty: 'Mrs. ANITHA M', room: 'A212' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Monday', timeIndex: 4, subject: 'DST', type: 'class' as const, faculty: 'Mr. SOUNDHUR', room: 'A212' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Monday', timeIndex: 5, subject: 'NET', type: 'class' as const, faculty: 'Mrs. ANITHA M', room: 'CSL-2' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Monday', timeIndex: 7, subject: 'OOPS LAB', type: 'class' as const, faculty: 'Ms. MYSHREE B', room: 'CSL-1' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Monday', timeIndex: 8, subject: 'OOPS LAB', type: 'class' as const, faculty: 'Ms. MYSHREE B', room: 'CSL-1' },
    // Tuesday
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Tuesday', timeIndex: 0, subject: 'DPCO', type: 'class' as const, faculty: 'Ms. RANJANI J', room: 'A212' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Tuesday', timeIndex: 1, subject: 'DST', type: 'class' as const, faculty: 'Mr. SOUNDHUR', room: 'A212' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Tuesday', timeIndex: 3, subject: 'FDS LAB', type: 'class' as const, faculty: 'Mrs. ANITHA M', room: 'CSL-2' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Tuesday', timeIndex: 4, subject: 'FDS LAB', type: 'class' as const, faculty: 'Mrs. ANITHA M', room: 'CSL-2' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Tuesday', timeIndex: 5, subject: 'FDS LAB', type: 'class' as const, faculty: 'Mrs. ANITHA M', room: 'CSL-2' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Tuesday', timeIndex: 7, subject: 'OOPS', type: 'class' as const, faculty: 'Ms. MYSHREE B', room: 'A212' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Tuesday', timeIndex: 9, subject: 'NSS', type: 'common' as const, faculty: 'Mr. CHITHAMBARAM', room: 'G-1' },
    // Wednesday
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Wednesday', timeIndex: 1, subject: 'DST', type: 'class' as const, faculty: 'Mr. SOUNDHUR', room: 'A212' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Wednesday', timeIndex: 3, subject: 'FDS', type: 'class' as const, faculty: 'Mrs. ANITHA M', room: 'A212' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Wednesday', timeIndex: 4, subject: 'OOPS', type: 'class' as const, faculty: 'Ms. MYSHREE B', room: 'A212' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Wednesday', timeIndex: 5, subject: 'DST', type: 'class' as const, faculty: 'Mr. SOUNDHUR', room: 'A212' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Wednesday', timeIndex: 7, subject: 'DS LAB', type: 'class' as const, faculty: 'Mr. SOUNDHUR', room: 'CSL-1' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Wednesday', timeIndex: 8, subject: 'DS LAB', type: 'class' as const, faculty: 'Mr. SOUNDHUR', room: 'CSL-1' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Wednesday', timeIndex: 9, subject: 'FDS', type: 'class' as const, faculty: 'Mrs. ANITHA M', room: 'A212' },
    // Thursday
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Thursday', timeIndex: 0, subject: 'DST', type: 'class' as const, faculty: 'Mr. SOUNDHUR', room: 'A212' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Thursday', timeIndex: 1, subject: 'FDS', type: 'class' as const, faculty: 'Mrs. ANITHA M', room: 'A212' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Thursday', timeIndex: 3, subject: 'OOPS', type: 'class' as const, faculty: 'Ms. MYSHREE B', room: 'A212' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Thursday', timeIndex: 5, subject: 'DPCO', type: 'class' as const, faculty: 'Ms. RANJANI J', room: 'A212' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Thursday', timeIndex: 7, subject: 'DS LAB', type: 'class' as const, faculty: 'Mr. SOUNDHUR', room: 'CSL-1' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Thursday', timeIndex: 8, subject: 'DS LAB', type: 'class' as const, faculty: 'Mr. SOUNDHUR', room: 'CSL-1' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Thursday', timeIndex: 9, subject: 'DS LAB', type: 'class' as const, faculty: 'Mr. SOUNDHUR', room: 'CSL-1' },
    // Friday
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Friday', timeIndex: 0, subject: 'DPCO', type: 'class' as const, faculty: 'Ms. RANJANI J', room: 'A212' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Friday', timeIndex: 1, subject: 'DST', type: 'class' as const, faculty: 'Mr. SOUNDHUR', room: 'A212' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Friday', timeIndex: 3, subject: 'LIB', type: 'common' as const, faculty: 'Mrs. ANITHA M', room: 'Library' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Friday', timeIndex: 4, subject: 'OOPS', type: 'class' as const, faculty: 'Ms. MYSHREE B', room: 'A212' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Friday', timeIndex: 5, subject: 'DST', type: 'class' as const, faculty: 'Mr. SOUNDHUR', room: 'A212' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Friday', timeIndex: 7, subject: 'FDS', type: 'class' as const, faculty: 'Mrs. ANITHA M', room: 'A212' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Friday', timeIndex: 8, subject: 'DPCO', type: 'class' as const, faculty: 'Ms. RANJANI J', room: 'A212' },
];


const INITIAL_LEAVE_REQUESTS: LeaveRequest[] = [
    { id: uuidv4(), facultyId: 'faculty-soundhur', facultyName: 'Mr. SOUNDHUR', timetableEntryId: 'cse-3-mon-1', day: 'Monday', timeIndex: 1, status: 'pending', reason: 'Personal emergency', timestamp: new Date().getTime() - 3600000 }
];

const INITIAL_AUDIT_LOG: AuditLogEntry[] = [
    { id: uuidv4(), timestamp: new Date().getTime() - 10000, userId: 'ADMIN', action: 'LOGIN_SUCCESS', ip: '192.168.1.1', status: 'success' },
    { id: uuidv4(), timestamp: new Date().getTime() - 60000, userId: 'Alice', action: 'VIEW_TIMETABLE', ip: '10.0.0.5', status: 'info' },
    { id: uuidv4(), timestamp: new Date().getTime() - 3661000, userId: 'Ms. YUVASRI', action: 'LOGIN_FAILURE', ip: '203.0.113.15', status: 'failure', details: 'Invalid credentials' },
    { id: uuidv4(), timestamp: new Date().getTime() - 3662000, userId: 'Ms. YUVASRI', action: 'LOGIN_FAILURE', ip: '203.0.113.15', status: 'failure', details: 'Invalid credentials' },
    { id: uuidv4(), timestamp: new Date().getTime() - 3663000, userId: 'Ms. YUVASRI', action: 'LOGIN_FAILURE', ip: '203.0.113.15', status: 'failure', details: 'Invalid credentials' },
    { id: uuidv4(), timestamp: new Date().getTime() - 3600000, userId: 'Ms. YUVASRI', action: 'LOGIN_SUCCESS', ip: '198.51.100.22', status: 'success' },
];

const INITIAL_SECURITY_ALERTS: SecurityAlert[] = [
    {
        id: uuidv4(),
        type: 'Anomaly',
        title: 'Unusual Login Pattern Detected',
        description: 'User "Ms. YUVASRI" (faculty, MATHS) had 3 failed login attempts from IP 203.0.113.15 followed by a successful login from IP 198.51.100.22 within 5 minutes.',
        timestamp: new Date().getTime() - 3600000,
        severity: 'high',
        relatedUserId: 'faculty-yuvasri',
        isResolved: false,
    }
];

const INITIAL_DEADLINES: Deadline[] = [
    { id: 'deadline-1', title: 'Mid-term Grade Submission', dueDate: new Date().getTime() + 7 * 86400000, audience: ['faculty', 'hod'] },
    { id: 'deadline-2', title: 'Course Registration for Next Semester', dueDate: new Date().getTime() + 14 * 86400000, audience: ['student'] },
    { id: 'deadline-3', title: 'Final Year Project Proposals Due', dueDate: new Date().getTime() + 21 * 86400000, audience: ['student'] },
];

const findScheduleConflicts = (entries: TimetableEntry[]): ScheduleConflict[] => {
    const conflicts: ScheduleConflict[] = [];
    const groupedByTime = entries.reduce((acc, entry) => {
        if(entry.type !== 'class') return acc;
        const key = `${entry.day}-${entry.timeIndex}`;
        if (!acc[key]) acc[key] = [];
        acc[key].push(entry);
        return acc;
    }, {} as Record<string, TimetableEntry[]>);

    for (const key in groupedByTime) {
        const slotEntries = groupedByTime[key];
        if (slotEntries.length <= 1) continue;

        const facultyBookings = new Map<string, TimetableEntry[]>();
        const classBookings = new Map<string, TimetableEntry[]>();
        const roomBookings = new Map<string, TimetableEntry[]>();

        slotEntries.forEach(entry => {
            if (entry.faculty) {
                if (!facultyBookings.has(entry.faculty)) facultyBookings.set(entry.faculty, []);
                facultyBookings.get(entry.faculty)!.push(entry);
            }
             if (entry.room) {
                if (!roomBookings.has(entry.room)) roomBookings.set(entry.room, []);
                roomBookings.get(entry.room)!.push(entry);
            }
            const classKey = `${entry.department}-${entry.year}`;
            if (!classBookings.has(classKey)) classBookings.set(classKey, []);
            classBookings.get(classKey)!.push(entry);
        });

        facultyBookings.forEach((bookings, faculty) => {
            if (bookings.length > 1) {
                conflicts.push({
                    type: 'Faculty',
                    identifier: faculty,
                    entries: bookings,
                    description: `Faculty ${faculty} is booked for ${bookings.length} classes at the same time.`
                });
            }
        });
        
        classBookings.forEach((bookings, classId) => {
            if (bookings.length > 1 && classId !== 'all-all') { // ignore common slots
                 conflicts.push({
                    type: 'Class',
                    identifier: classId.replace('-', ' Year '),
                    entries: bookings,
                    description: `Class ${classId.replace('-', ' Year ')} is booked for ${bookings.length} classes at the same time.`
                });
            }
        });

        roomBookings.forEach((bookings, room) => {
            if (bookings.length > 1) {
                conflicts.push({
                    type: 'Room',
                    identifier: room,
                    entries: bookings,
                    description: `Room ${room} is booked for ${bookings.length} classes at the same time.`
                });
            }
        });
    }
    return conflicts;
};


// --- REACT CONTEXT ---
interface AppContextType {
    currentUser: User | null;
    addNotification: (message: string, type: AppNotification['type']) => void;
}
const AppContext = createContext<AppContextType | null>(null);
const useAppContext = () => {
    const context = useContext(AppContext);
    if (!context) {
        throw new Error('useAppContext must be used within an AppProvider');
    }
    return context;
};

// --- HELPER COMPONENTS ---
const LoadingSpinner: React.FC = () => <div className="spinner"></div>;
const LoadingSpinnerSm: React.FC = () => <div className="spinner-sm"></div>;

const SkeletonLoader: React.FC = () => (
    <div className="briefing-skeleton-loader">
        <div className="skeleton skeleton-line" style={{ width: '80%' }}></div>
        <div className="skeleton skeleton-line" style={{ width: '60%' }}></div>
        <div className="skeleton skeleton-line" style={{ width: '90%', marginTop: '1rem' }}></div>
        <div className="skeleton skeleton-line" style={{ width: '70%' }}></div>
    </div>
);

const Modal: React.FC<{ isOpen: boolean; onClose: () => void; children: React.ReactNode; title: string; className?: string }> = ({ isOpen, onClose, children, title, className = '' }) => {
    if (!isOpen) return null;

    return (
        <div className={`modal-overlay ${isOpen ? 'open' : ''}`} onClick={onClose}>
            <div className={`modal-content ${className}`} onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>{title}</h3>
                    <button onClick={onClose} className="close-modal-btn" aria-label="Close modal">&times;</button>
                </div>
                {children}
            </div>
        </div>
    );
};

const NotificationCenter: React.FC<{
    notifications: AppNotification[];
    onDismiss: (id: string) => void;
}> = ({ notifications, onDismiss }) => {
    return (
        <div className="notification-container">
            {notifications.map(notif => (
                <div key={notif.id} className={`notification-item ${notif.type}`}>
                    <p className="notification-message">{notif.message}</p>
                    <button className="notification-dismiss" onClick={() => onDismiss(notif.id)}>&times;</button>
                </div>
            ))}
        </div>
    );
};

const ThemeToggle: React.FC<{ theme: 'light' | 'dark', setTheme: (theme: 'light' | 'dark') => void }> = ({ theme, setTheme }) => {
    const toggle = () => setTheme(theme === 'light' ? 'dark' : 'light');
    return (
        <button onClick={toggle} className="theme-toggle" aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
            {theme === 'light' ? Icons.moon : Icons.sun}
        </button>
    );
};

const Header: React.FC<{
    currentView: string;
    onMenuToggle: () => void;
    onLogout: () => void;
    theme: 'light' | 'dark';
    setTheme: (theme: 'light' | 'dark') => void;
}> = ({ currentView, onMenuToggle, onLogout, theme, setTheme }) => {
    const { currentUser } = useAppContext();
    return (
        <header className="header">
            <div className="header-left">
                <button className="menu-toggle" onClick={onMenuToggle} aria-label="Open sidebar">
                    {Icons.menu}
                </button>
                <h1 className="header-title">{currentView}</h1>
            </div>
            <div className="header-right">
                 <ThemeToggle theme={theme} setTheme={setTheme} />
                <div className="user-info">
                    <span>{currentUser?.name}</span>
                    <small>{currentUser?.role}</small>
                </div>
                <button onClick={onLogout} className="btn btn-secondary btn-sm">Logout</button>
            </div>
        </header>
    );
};

// --- MAIN APP COMPONENTS ---

const LoginView: React.FC<{
    onLogin: (user: User) => void;
    onRegister: (user: User) => Promise<boolean>;
    users: User[];
}> = ({ onLogin, onRegister, users }) => {
    const [isLogin, setIsLogin] = useState(true);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState<UserRole>('student');
    const [dept, setDept] = useState(DEPARTMENTS[0]);
    const [year, setYear] = useState(YEARS[0]);
    const [authError, setAuthError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const { addNotification } = useAppContext();

    const handleLogin = (e: React.FormEvent) => {
        e.preventDefault();
        setAuthError('');
        const user = users.find(u => u.name.toLowerCase() === username.toLowerCase() && u.password === password);
        if (user) {
            if (user.status === 'pending_approval') {
                setAuthError("Your account is pending administrator approval.");
            } else if (user.status === 'rejected') {
                setAuthError("Your account registration was rejected.");
            } else if (user.isLocked) {
                setAuthError("Your account has been locked due to suspicious activity. Please contact an administrator.");
            }
            else {
                onLogin(user);
            }
        } else {
            setAuthError('Invalid username or password.');
        }
    };

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setAuthError('');
        setIsLoading(true);

        const newUser: User = {
            id: `${role}-${username.toLowerCase().replace(/\s/g, '-')}`,
            name: username,
            password,
            role,
            dept: role === 'admin' ? 'all' : dept,
            year: (role === 'student' || role === 'class advisor') ? year : undefined,
            status: 'pending_approval',
            hasCompletedOnboarding: false, // New users have not seen the guide
        };

        const success = await onRegister(newUser);
        setIsLoading(false);
        if (success) {
            setIsLogin(true);
        } else {
            setAuthError("Registration failed. This user may already exist.");
        }
    };

    const formContent = isLogin ? (
        <form onSubmit={handleLogin}>
            <div className="control-group">
                <label htmlFor="username">Username</label>
                <input
                    type="text"
                    id="username"
                    className="form-control"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                />
            </div>
            <div className="control-group">
                <label htmlFor="password">Password</label>
                <input
                    type="password"
                    id="password"
                    className="form-control"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                />
            </div>
            {authError && <p className="auth-error">{authError}</p>}
            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}>Login</button>
            <p className="auth-toggle">
                Don't have an account? <button type="button" onClick={() => { setIsLogin(false); setAuthError('') }}>Sign Up</button>
            </p>
        </form>
    ) : (
        <form onSubmit={handleRegister} className="signup-form">
            <div className="control-group">
                <label htmlFor="reg-username">Username</label>
                <input type="text" id="reg-username" className="form-control" value={username} onChange={e => setUsername(e.target.value)} required />
            </div>
            <div className="control-group">
                <label htmlFor="reg-password">Password</label>
                <input type="password" id="reg-password" className="form-control" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            <div className="control-group">
                <label htmlFor="reg-role">Role</label>
                <select id="reg-role" className="form-control" value={role} onChange={e => setRole(e.target.value as UserRole)}>
                    <option value="student">Student</option>
                    <option value="faculty">Faculty</option>
                    <option value="class advisor">Class Advisor</option>
                    <option value="admin">Admin</option>
                </select>
            </div>
            {role !== 'admin' && (
                <>
                    <div className="control-group">
                        <label htmlFor="reg-dept">Department</label>
                        <select id="reg-dept" className="form-control" value={dept} onChange={e => setDept(e.target.value)}>
                            {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                    </div>
                    {(role === 'student' || role === 'class advisor') && (
                        <div className="control-group">
                            <label htmlFor="reg-year">Year</label>
                            <select id="reg-year" className="form-control" value={year} onChange={e => setYear(e.target.value)}>
                                {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                            </select>
                        </div>
                    )}
                </>
            )}
            {authError && <p className="auth-error">{authError}</p>}
            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }} disabled={isLoading}>
                {isLoading ? <LoadingSpinnerSm /> : 'Sign Up'}
            </button>
            <p className="auth-toggle">
                Already have an account? <button type="button" onClick={() => { setIsLogin(true); setAuthError('') }}>Login</button>
            </p>
        </form>
    );

    return (
        <div className="login-view-container">
            <div className="login-card">
                <div className="login-header">
                    <div className="logo">{Icons.logo}</div>
                    <h1>AI Academic Assistant</h1>
                </div>
                {formContent}
            </div>
        </div>
    );
};

const UserManagementView: React.FC<{
    users: User[];
    setUsers: React.Dispatch<React.SetStateAction<User[]>>;
    addAuditLog: (entry: Omit<AuditLogEntry, 'id' | 'timestamp'>) => void;
    addNotification: (message: string, type: AppNotification['type']) => void;
}> = ({ users, setUsers, addAuditLog, addNotification }) => {
    const { currentUser } = useAppContext();
    const [searchTerm, setSearchTerm] = useState('');
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [editFormData, setEditFormData] = useState<Partial<User>>({});

    const handleApprove = (userToApprove: User) => {
        setUsers(prev => prev.map(u => u.id === userToApprove.id ? { ...u, status: 'active' } : u));
        addAuditLog({ userId: currentUser!.name, action: 'APPROVE_USER', ip: '192.168.1.1', status: 'success', details: `Approved user: ${userToApprove.name}` });
        addNotification(`User "${userToApprove.name}" has been approved.`, 'success');
    };

    const handleReject = (userToReject: User) => {
        setUsers(prev => prev.map(u => u.id === userToReject.id ? { ...u, status: 'rejected' } : u));
        addAuditLog({ userId: currentUser!.name, action: 'REJECT_USER', ip: '192.168.1.1', status: 'success', details: `Rejected user: ${userToReject.name}` });
        addNotification(`User "${userToReject.name}" has been rejected.`, 'warning');
    };
    
    const handleLockToggle = (userToToggle: User) => {
        const isLocking = !userToToggle.isLocked;
        setUsers(prev => prev.map(u => u.id === userToToggle.id ? { ...u, isLocked: isLocking } : u));
        addAuditLog({ userId: currentUser!.name, action: isLocking ? 'LOCK_USER' : 'UNLOCK_USER', ip: '192.168.1.1', status: 'success', details: `${isLocking ? 'Locked' : 'Unlocked'} user: ${userToToggle.name}` });
        addNotification(`User account for "${userToToggle.name}" has been ${isLocking ? 'locked' : 'unlocked'}.`, isLocking ? 'warning' : 'success');
    };
    
    const handleDelete = (userToDelete: User) => {
        if (window.confirm(`Are you sure you want to delete the user "${userToDelete.name}"? This action cannot be undone.`)) {
            setUsers(prev => prev.filter(u => u.id !== userToDelete.id));
            addAuditLog({ userId: currentUser!.name, action: 'DELETE_USER', ip: '192.168.1.1', status: 'success', details: `Deleted user: ${userToDelete.name}` });
            addNotification(`User "${userToDelete.name}" has been deleted.`, 'success');
        }
    };

    const handleEdit = (userToEdit: User) => {
        setEditingUser(userToEdit);
        setEditFormData(userToEdit);
        setIsEditModalOpen(true);
    };

    const handleUpdateUser = (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingUser) return;
        setUsers(prev => prev.map(u => u.id === editingUser.id ? { ...u, ...editFormData } as User : u));
        addAuditLog({ userId: currentUser!.name, action: 'UPDATE_USER', ip: '192.168.1.1', status: 'success', details: `Updated user: ${editFormData.name}` });
        addNotification(`User "${editFormData.name}" has been updated.`, 'success');
        setIsEditModalOpen(false);
        setEditingUser(null);
    };
    
    const handleEditFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setEditFormData(prev => {
            const updatedData: Partial<User> = { ...prev, [name]: value };
            if (name === 'role' && value !== 'student' && value !== 'class advisor') {
                delete updatedData.year;
            }
            return updatedData;
        });
    };

    const filteredUsers = users.filter(user =>
        user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.role.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.dept.toLowerCase().includes(searchTerm.toLowerCase())
    ).filter(user => user.role !== 'admin' || user.id !== currentUser?.id); // Don't show the current admin user themselves

    return (
        <div className="user-management-container">
            <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} title={`Edit User: ${editingUser?.name}`}>
                <form onSubmit={handleUpdateUser} className="entry-form" style={{ padding: 0, border: 'none', boxShadow: 'none' }}>
                    <div className="form-grid" style={{ gap: '1.5rem' }}>
                        <div className="control-group" style={{ gridColumn: '1 / -1' }}>
                            <label htmlFor="edit-name">Name</label>
                            <input id="edit-name" name="name" type="text" className="form-control" value={editFormData.name || ''} onChange={handleEditFormChange} required />
                        </div>
                        <div className="control-group">
                            <label htmlFor="edit-role">Role</label>
                            <select id="edit-role" name="role" className="form-control" value={editFormData.role || ''} onChange={handleEditFormChange}>
                                <option value="student">Student</option>
                                <option value="faculty">Faculty</option>
                                <option value="class advisor">Class Advisor</option>
                                <option value="hod">HOD</option>
                            </select>
                        </div>
                        <div className="control-group">
                            <label htmlFor="edit-dept">Department</label>
                            <select id="edit-dept" name="dept" className="form-control" value={editFormData.dept || ''} onChange={handleEditFormChange}>
                                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </div>
                        {(editFormData.role === 'student' || editFormData.role === 'class advisor') && (
                            <div className="control-group" style={{ gridColumn: '1 / -1' }}>
                                <label htmlFor="edit-year">Year</label>
                                <select id="edit-year" name="year" className="form-control" value={editFormData.year || ''} onChange={handleEditFormChange}>
                                    {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                                </select>
                            </div>
                        )}
                    </div>
                    <div className="form-actions" style={{paddingTop: '1rem'}}>
                        <button type="button" className="btn btn-secondary" onClick={() => setIsEditModalOpen(false)}>Cancel</button>
                        <button type="submit" className="btn btn-primary">Save Changes</button>
                    </div>
                </form>
            </Modal>
            <div className="directory-header">
                <h2>User Directory</h2>
                <div className="directory-controls">
                    <input
                        type="text"
                        placeholder="Search by name, role, or department..."
                        className="form-control"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>
            <div className="entry-list-container">
                <table className="entry-list-table user-management-table">
                    <thead>
                        <tr>
                            <th>User</th>
                            <th>Role</th>
                            <th>Department / Class</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredUsers.map(user => (
                            <tr key={user.id}>
                                <td>
                                    <div className="user-name-cell">
                                        <span>{user.name}</span>
                                        <small>{user.id}</small>
                                    </div>
                                </td>
                                <td style={{textTransform: 'capitalize'}}>{user.role}</td>
                                <td>
                                     <div className="user-name-cell">
                                        <span>{user.dept.toUpperCase()}</span>
                                        {user.year && <small>Year {user.year}</small>}
                                    </div>
                                </td>
                                <td>
                                    {user.isLocked ? (
                                        <span className={`status-pill locked`}>Locked</span>
                                    ) : (
                                        <span className={`status-pill ${user.status.includes('pending') ? 'pending' : user.status === 'active' ? 'approved' : 'rejected'}`}>
                                            {user.status.replace('_', ' ')}
                                        </span>
                                    )}
                                </td>
                                <td className="entry-actions">
                                    {user.status === 'pending_approval' ? (
                                        <>
                                            <button onClick={() => handleApprove(user)} title="Approve User" className="btn-action approve">{Icons.check}</button>
                                            <button onClick={() => handleReject(user)} title="Reject User" className="btn-action reject">{Icons.x}</button>
                                        </>
                                    ) : (
                                        <>
                                            <button onClick={() => handleEdit(user)} title="Edit User" className="btn-action edit">{Icons.editPencil}</button>
                                            <button onClick={() => handleLockToggle(user)} title={user.isLocked ? "Unlock Account" : "Lock Account"} className={`btn-action ${user.isLocked ? 'unlock' : 'lock'}`}>
                                                {user.isLocked ? Icons.checkCircle : Icons.lock}
                                            </button>
                                        </>
                                    )}
                                    <button onClick={() => handleDelete(user)} title="Delete User" className="btn-action delete">{Icons.delete}</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};


const AnnouncementsView: React.FC<{
    announcements: Announcement[];
    setAnnouncements: React.Dispatch<React.SetStateAction<Announcement[]>>;
}> = ({ announcements, setAnnouncements }) => {
    const { currentUser, addNotification } = useAppContext();
    const [isCreating, setIsCreating] = useState(false);
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [targetRole, setTargetRole] = useState<'all' | 'student' | 'faculty'>('all');
    const [targetDept, setTargetDept] = useState<Announcement['targetDept']>('all');
    const [isRefining, setIsRefining] = useState(false);

    const canCreate = currentUser?.role === 'admin' || currentUser?.role === 'hod';

    const visibleAnnouncements = announcements
        .filter(a =>
            (a.targetRole === 'all' || a.targetRole === currentUser?.role) &&
            (a.targetDept === 'all' || a.targetDept === currentUser?.dept)
        )
        .sort((a, b) => b.timestamp - a.timestamp);

    const handleRefine = async () => {
        if (!ai || !content) {
            addNotification("Content is empty or AI is disabled.", "warning");
            return;
        }
        setIsRefining(true);
        try {
            const prompt = `You are a helpful assistant for a college administrator. Refine the following announcement content to be more professional, clear, and concise. Do not add any new information. Just improve the existing text. Return only the refined text.
            
            Original content: "${content}"`;
            
            const response = await ai.models.generateContent({model: 'gemini-2.5-flash', contents: prompt});
            setContent(response.text);
            addNotification("Content refined by AI.", "success");
        } catch (error) {
            console.error("AI refinement failed:", error);
            addNotification("Failed to refine content with AI.", "error");
        } finally {
            setIsRefining(false);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim() || !content.trim()) {
            addNotification("Title and content cannot be empty.", "error");
            return;
        }
        const newAnnouncement: Announcement = {
            id: uuidv4(),
            title,
            content,
            author: currentUser?.role === 'hod' ? `HOD (${currentUser.dept})` : 'Admin',
            timestamp: new Date().getTime(),
            targetRole,
            targetDept
        };
        setAnnouncements(prev => [newAnnouncement, ...prev]);
        addNotification("Announcement published successfully.", "success");
        // Reset form
        setIsCreating(false);
        setTitle('');
        setContent('');
        setTargetRole('all');
        setTargetDept('all');
    };

    return (
        <div className="announcements-view-container">
            <div className="announcements-header">
                <h2>Announcements</h2>
                {canCreate && (
                    <button className="btn btn-primary" onClick={() => setIsCreating(!isCreating)}>
                        {isCreating ? 'Cancel' : 'Create Announcement'}
                    </button>
                )}
            </div>

            {isCreating && (
                <form className="create-announcement-form" onSubmit={handleSubmit}>
                    <h3>New Announcement</h3>
                    <div className="control-group">
                        <label htmlFor="ann-title">Title</label>
                        <input id="ann-title" type="text" className="form-control" value={title} onChange={e => setTitle(e.target.value)} required />
                    </div>
                    <div className="control-group">
                        <label htmlFor="ann-content">Content</label>
                        <div className="refine-button-container">
                            <textarea id="ann-content" className="form-control" value={content} onChange={e => setContent(e.target.value)} required />
                            {isAiEnabled && (
                                <button type="button" className="btn btn-secondary btn-sm refine-btn" onClick={handleRefine} disabled={isRefining}>
                                    {isRefining ? <LoadingSpinnerSm /> : Icons.lightbulb}
                                    Refine with AI
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="form-grid">
                        <div className="control-group">
                            <label htmlFor="ann-role">Target Role</label>
                            <select id="ann-role" className="form-control" value={targetRole} onChange={e => setTargetRole(e.target.value as any)}>
                                <option value="all">All Roles</option>
                                <option value="student">Students</option>
                                <option value="faculty">Faculty</option>
                            </select>
                        </div>
                        <div className="control-group">
                            <label htmlFor="ann-dept">Target Department</label>
                            <select id="ann-dept" className="form-control" value={targetDept} onChange={e => setTargetDept(e.target.value as any)}>
                                <option value="all">All Departments</option>
                                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </div>
                    </div>
                    <div className="form-actions">
                        <button type="submit" className="btn btn-primary">Publish</button>
                    </div>
                </form>
            )}

            <div className="announcement-list">
                {visibleAnnouncements.length > 0 ? (
                    visibleAnnouncements.map(ann => (
                        <div key={ann.id} className="announcement-card">
                            <div className="announcement-item-header">
                                <h3>{ann.title}</h3>
                                <div className="announcement-item-meta">
                                    <span>By <strong>{ann.author}</strong></span>
                                    <small>{getRelativeTime(ann.timestamp)}</small>
                                </div>
                            </div>
                            <div className="announcement-item-targets">
                                <span className="target-pill">{ann.targetRole}</span>
                                <span className="target-pill">{ann.targetDept}</span>
                            </div>
                            <p className="announcement-item-content">{ann.content}</p>
                        </div>
                    ))
                ) : (
                    <p className="no-history-text">No announcements found.</p>
                )}
            </div>
        </div>
    );
};

const SecurityCenterView: React.FC<{
    auditLog: AuditLogEntry[];
    users: User[];
    securityAlerts: SecurityAlert[];
    setSecurityAlerts: React.Dispatch<React.SetStateAction<SecurityAlert[]>>;
    setUsers: (users: User[] | ((prev: User[]) => User[])) => void;
}> = ({ auditLog, users, securityAlerts, setSecurityAlerts, setUsers }) => {
    const { addNotification } = useAppContext();
    const [activeTab, setActiveTab] = useState<'guardian' | 'log'>('guardian');

    return (
        <div className="security-center-container">
            <div className="tabs">
                <button
                    className={`tab-button ${activeTab === 'guardian' ? 'active' : ''}`}
                    onClick={() => setActiveTab('guardian')}
                    aria-selected={activeTab === 'guardian'}
                >
                    {Icons.guardian} Digital Guardian AI
                </button>
                <button
                    className={`tab-button ${activeTab === 'log' ? 'active' : ''}`}
                    onClick={() => setActiveTab('log')}
                    aria-selected={activeTab === 'log'}
                >
                    Audit Log
                </button>
            </div>
            <div className="tab-content">
                {activeTab === 'guardian' ? (
                    <DigitalGuardianView
                        auditLog={auditLog}
                        users={users}
                        securityAlerts={securityAlerts}
                        setSecurityAlerts={setSecurityAlerts}
                        setUsers={setUsers}
                    />
                ) : (
                    <AuditLogView auditLog={auditLog} />
                )}
            </div>
        </div>
    );
};

const AuditLogView: React.FC<{ auditLog: AuditLogEntry[] }> = ({ auditLog }) => {
    return (
        <div className="entry-list-container">
            <table className="entry-list-table">
                <thead>
                    <tr>
                        <th>Timestamp</th>
                        <th>User ID</th>
                        <th>Action</th>
                        <th>IP Address</th>
                        <th>Status</th>
                        <th>Details</th>
                    </tr>
                </thead>
                <tbody>
                    {[...auditLog].sort((a, b) => b.timestamp - a.timestamp).map(entry => (
                        <tr key={entry.id}>
                            <td>{new Date(entry.timestamp).toLocaleString()}</td>
                            <td>{entry.userId}</td>
                            <td>{entry.action}</td>
                            <td>{entry.ip}</td>
                            <td><span className={`status-pill ${entry.status === 'success' ? 'approved' : entry.status === 'failure' ? 'rejected' : 'pending'}`}>{entry.status}</span></td>
                            <td>{entry.details || 'N/A'}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const DigitalGuardianView: React.FC<{
    auditLog: AuditLogEntry[];
    users: User[];
    securityAlerts: SecurityAlert[];
    setSecurityAlerts: React.Dispatch<React.SetStateAction<SecurityAlert[]>>;
    setUsers: (users: User[] | ((prev: User[]) => User[])) => void;
}> = ({ auditLog, users, securityAlerts, setSecurityAlerts, setUsers }) => {
    const { addNotification } = useAppContext();
    const [isLoading, setIsLoading] = useState({ drill: false, anomaly: false });
    const [generatingResponseFor, setGeneratingResponseFor] = useState<string | null>(null);
    const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);

    const systemStatus = useMemo(() => {
        const unresolvedAlerts = securityAlerts.filter(a => !a.isResolved);
        if (unresolvedAlerts.some(a => a.severity === 'critical' || a.severity === 'high')) {
            return { text: 'Threat Detected', severity: 'high' };
        }
        if (unresolvedAlerts.some(a => a.severity === 'medium')) {
            return { text: 'Warning', severity: 'medium' };
        }
        return { text: 'System Secure', severity: 'low' };
    }, [securityAlerts]);

    const handleRunDrill = async () => {
        if (!ai) {
            addNotification("AI features are disabled.", "error");
            return;
        }
        setIsLoading(prev => ({ ...prev, drill: true }));
        try {
            const prompt = `You are a cybersecurity expert running a security drill on a web application.
            Based on the following recent audit log entries, invent a plausible security threat scenario (e.g., SQL injection attempt, XSS probe, brute-force login, privilege escalation attempt).
            Generate a concise report about this simulated threat.

            Audit Log Sample: ${JSON.stringify(auditLog.slice(0, 15).map(l => ({ action: l.action, user: l.userId, ip: l.ip, status: l.status })))}

            Your response must be a JSON object with the following structure:
            - title: A short, descriptive title for the drill result (e.g., "Simulated XSS Vulnerability").
            - description: A detailed explanation of the simulated threat and the potential vulnerability it exploits.
            - severity: A severity level from "low", "medium", "high", or "critical".
            - relatedUserId: (Optional) The ID of a user related to this drill, choose one from the logs if applicable.
            `;

            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            title: { type: Type.STRING },
                            description: { type: Type.STRING },
                            severity: { type: Type.STRING },
                            relatedUserId: { type: Type.STRING, nullable: true },
                        }
                    }
                }
            });

            const newAlertData = JSON.parse(response.text);
            const newAlert: SecurityAlert = {
                id: uuidv4(),
                type: 'DrillResult',
                timestamp: new Date().getTime(),
                isResolved: false,
                ...newAlertData,
            };
            setSecurityAlerts(prev => [newAlert, ...prev]);
            addNotification("Security drill completed successfully.", "success");

        } catch (error) {
            console.error("Security drill failed:", error);
            addNotification("Failed to run security drill.", "error");
        } finally {
            setIsLoading(prev => ({ ...prev, drill: false }));
        }
    };

    const handleAnalyzeLogs = async () => {
        if (!ai) {
            addNotification("AI features are disabled.", "error");
            return;
        }
        setIsLoading(prev => ({ ...prev, anomaly: true }));
        try {
            const prompt = `You are an AI security analyst. Analyze these web application audit logs for anomalies or suspicious patterns.
            An example is multiple failed logins for one user from one IP followed by a successful login from a different IP.
            If you find a credible anomaly, report it. If not, respond with an empty JSON object.

            Logs: ${JSON.stringify(auditLog.map(l => ({ action: l.action, user: l.userId, ip: l.ip, status: l.status, time: new Date(l.timestamp).toISOString() })))}

            Your response must be a JSON object with the following structure if an anomaly is found, otherwise it's an empty object {}:
            - title: A short, descriptive title for the anomaly.
            - description: A detailed explanation of the anomaly and why it's suspicious.
            - severity: "low", "medium", "high", or "critical".
            - relatedUserId: The ID of the user involved.
            `;

            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            title: { type: Type.STRING, nullable: true },
                            description: { type: Type.STRING, nullable: true },
                            severity: { type: Type.STRING, nullable: true },
                            relatedUserId: { type: Type.STRING, nullable: true },
                        }
                    }
                }
            });

            const newAlertData = JSON.parse(response.text);

            if (newAlertData.title) {
                 const newAlert: SecurityAlert = {
                    id: uuidv4(),
                    type: 'Anomaly',
                    timestamp: new Date().getTime(),
                    isResolved: false,
                    ...newAlertData,
                };
                setSecurityAlerts(prev => [newAlert, ...prev.filter(a => a.title !== newAlert.title)]); // Avoid duplicates
                addNotification("New security anomaly detected!", "warning");
            } else {
                addNotification("No new anomalies found in logs.", "info");
            }

        } catch (error) {
            console.error("Log analysis failed:", error);
            addNotification("Failed to analyze audit logs.", "error");
        } finally {
            setIsLoading(prev => ({ ...prev, anomaly: false }));
        }
    };
    
    const handleGenerateResponse = async (alert: SecurityAlert) => {
        if (!ai) {
            addNotification("AI features are disabled.", "error");
            return;
        }
        setGeneratingResponseFor(alert.id);
        try {
            const prompt = `You are an expert cybersecurity incident responder. For the following security alert, generate a clear, step-by-step incident response plan.

            Alert Details:
            - Title: ${alert.title}
            - Description: ${alert.description}
            - Severity: ${alert.severity}

            The plan must include three sections: "containment", "investigation", and "recovery".
            Based on the alert, suggest a single, primary recommended action from this list: 'LOCK_USER', 'MONITOR', 'NONE'. Choose 'LOCK_USER' for credible account compromise scenarios.

            Return the plan as a JSON object with this exact structure:
            {
                "containment": "...",
                "investigation": "...",
                "recovery": "...",
                "recommendedAction": "..."
            }
            `;
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                 config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                           containment: {type: Type.STRING},
                           investigation: {type: Type.STRING},
                           recovery: {type: Type.STRING},
                           recommendedAction: {type: Type.STRING},
                        }
                    }
                }
            });

            const plan = JSON.parse(response.text);
            setSecurityAlerts(prevAlerts =>
                prevAlerts.map(a => a.id === alert.id ? { ...a, responsePlan: plan } : a)
            );

        } catch (error) {
            console.error("Failed to generate response plan:", error);
            addNotification("Failed to generate AI response plan.", "error");
        } finally {
            setGeneratingResponseFor(null);
        }
    };
    
    const handleLockUser = (userIdToLock: string) => {
        setUsers(prevUsers => {
            const userToLock = prevUsers.find(u => u.id === userIdToLock);
            if(userToLock) {
                addNotification(`User account for "${userToLock.name}" has been locked.`, "success");
            }
            return prevUsers.map(u => u.id === userIdToLock ? { ...u, isLocked: true } : u);
        });
    };

    const handleResolveAlert = (alertId: string) => {
        setSecurityAlerts(prev =>
            prev.map(a => a.id === alertId ? { ...a, isResolved: true } : a)
        );
        addNotification("Alert has been marked as resolved.", "info");
    };

    return (
        <div className="guardian-dashboard">
            <div className="guardian-dashboard-grid">
                <div className={`status-card severity-${systemStatus.severity}`}>
                    <div className="status-indicator">
                        {systemStatus.severity === 'low' ? Icons.shieldCheck : Icons.shieldExclamation}
                    </div>
                    <div className="status-text">
                        <h4>System Status</h4>
                        <p>{systemStatus.text}</p>
                    </div>
                </div>
                <div className="guardian-actions">
                     <button className="btn btn-secondary" onClick={handleRunDrill} disabled={isLoading.drill}>
                        {isLoading.drill ? <LoadingSpinnerSm/> : Icons.security}
                        <span>Run Security Drill</span>
                    </button>
                    <button className="btn btn-secondary" onClick={handleAnalyzeLogs} disabled={isLoading.anomaly}>
                        {isLoading.anomaly ? <LoadingSpinnerSm/> : Icons.lightbulb}
                        <span>Analyze Logs for Anomalies</span>
                    </button>
                </div>
            </div>

            <div className="alert-list-container">
                <h3>Active Security Alerts</h3>
                <ul className="alert-list">
                    {securityAlerts.filter(a => !a.isResolved).length > 0 ? (
                        securityAlerts.filter(a => !a.isResolved)
                         .sort((a,b) => b.timestamp - a.timestamp)
                         .map(alert => (
                            <li key={alert.id} className={`alert-item severity-${alert.severity}`} onClick={() => setSelectedAlertId(alert.id === selectedAlertId ? null : alert.id)} aria-expanded={selectedAlertId === alert.id}>
                                <div className="alert-item-header">
                                    <div className="alert-title">
                                        <span className="severity-icon">{Icons.warning}</span>
                                        <h5>{alert.title}</h5>
                                    </div>
                                    <div className="alert-meta">
                                        <span className={`status-pill severity-${alert.severity}`}>{alert.severity}</span>
                                        <small>{getRelativeTime(alert.timestamp)}</small>
                                    </div>
                                </div>
                                <p className="alert-description">{alert.description}</p>
                                {selectedAlertId === alert.id && (
                                    <div className="alert-details" onClick={e => e.stopPropagation()}>
                                        {alert.responsePlan ? (
                                            <div className="response-plan">
                                                <h4>{Icons.clipboardList} AI-Generated Response Plan</h4>
                                                <div className="response-plan-section">
                                                    <strong>Containment:</strong>
                                                    <p>{alert.responsePlan.containment}</p>
                                                </div>
                                                <div className="response-plan-section">
                                                    <strong>Investigation:</strong>
                                                    <p>{alert.responsePlan.investigation}</p>
                                                </div>
                                                 <div className="response-plan-section">
                                                    <strong>Recovery:</strong>
                                                    <p>{alert.responsePlan.recovery}</p>
                                                </div>
                                                <div className="alert-item-actions">
                                                    {alert.responsePlan.recommendedAction === 'LOCK_USER' && alert.relatedUserId && !users.find(u=>u.id === alert.relatedUserId)?.isLocked && (
                                                        <button className="btn btn-danger btn-sm" onClick={() => { handleLockUser(alert.relatedUserId!); handleResolveAlert(alert.id); }}>
                                                            {Icons.lock} Lock User Account
                                                        </button>
                                                    )}
                                                     <button className="btn btn-success btn-sm" onClick={() => handleResolveAlert(alert.id)}>
                                                        {Icons.checkCircle} Mark as Resolved
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="alert-item-actions">
                                                <button className="btn btn-primary btn-sm" onClick={() => handleGenerateResponse(alert)} disabled={generatingResponseFor === alert.id}>
                                                    {generatingResponseFor === alert.id ? <LoadingSpinnerSm/> : Icons.lightbulb}
                                                    Generate Response Plan
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </li>
                        ))
                    ) : (
                        <p className="no-history-text">No active security alerts.</p>
                    )}
                </ul>
            </div>
        </div>
    );
};


const Chatbot: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>([
        { id: uuidv4(), role: 'model', text: "Hello! I'm the AI Assistant. How can I help you with the college timetable or other academic matters today?" }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const chatHistoryRef = useRef<HTMLDivElement>(null);
    const { currentUser } = useAppContext();
    const chatSession = useRef<Chat | null>(null);

    useEffect(() => {
        if (chatHistoryRef.current) {
            chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
        }
    }, [messages]);

    const startChat = useCallback(() => {
        if (ai && currentUser) {
            chatSession.current = ai.chats.create({
                model: 'gemini-2.5-flash',
                config: {
                    systemInstruction: `You are an intelligent and proactive AI assistant for a college management app called "AcademiBot". You are an expert in academic administration, scheduling, and educational technology.
                    The current user is ${currentUser?.name}, who is a ${currentUser?.role} in the ${currentUser?.dept} department.
                    Today's date is ${new Date().toDateString()}.
                    Your primary goals are to:
                    1.  **Answer questions accurately**: Provide information about schedules, faculty, courses, and college policies.
                    2.  **Solve problems**: Help users find free classroom slots, suggest faculty substitutions for leave requests, identify schedule conflicts.
                    3.  **Be proactive**: Offer helpful suggestions based on the user's role and conversation. For example, if a student asks about their schedule, you could also mention an upcoming deadline. If an admin is managing timetables, you could offer to check for conflicts.
                    4.  **Maintain a professional, yet friendly and encouraging tone.**
                    Format important information clearly using markdown (lists, bold text, tables). Be concise but thorough.`,
                },
            });
        }
    }, [currentUser]);
    
    useEffect(() => {
        // Restart chat if user changes
        chatSession.current = null;
    }, [currentUser]);


    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;

        const userMessage: ChatMessage = { id: uuidv4(), role: 'user', text: input };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);

        if (!ai) {
            const errorMessage: ChatMessage = { id: uuidv4(), role: 'model', text: "Sorry, the AI service is not available right now.", isError: true };
            setMessages(prev => [...prev, errorMessage]);
            setIsLoading(false);
            return;
        }

        if (!chatSession.current) {
            startChat();
        }

        try {
            const responseStream = await chatSession.current!.sendMessageStream({ message: userMessage.text });

            let modelResponse = '';
            const modelMessageId = uuidv4();

            // Add a placeholder message for the model
            setMessages(prev => [...prev, { id: modelMessageId, role: 'model', text: '' }]);

            for await (const chunk of responseStream) {
                modelResponse += chunk.text;
                // Update the model's message in the state
                setMessages(prev => prev.map(msg =>
                    msg.id === modelMessageId ? { ...msg, text: modelResponse } : msg
                ));
            }

        } catch (error) {
            console.error("Chatbot error:", error);
            const errorMessage: ChatMessage = { id: uuidv4(), role: 'model', text: "Sorry, I encountered an error. Please try again.", isError: true };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <>
            <button className="chatbot-fab" onClick={() => setIsOpen(!isOpen)} aria-label="Toggle chatbot">
                {isOpen ? Icons.close : Icons.chatbot}
            </button>
            {isOpen && (
                <div className="chatbot-window">
                    <div className="chatbot-header">
                        <h3>AI Assistant</h3>
                        <button onClick={() => setIsOpen(false)} aria-label="Close chatbot">&times;</button>
                    </div>
                    <div className="chatbot-history" ref={chatHistoryRef}>
                        {messages.map(msg => (
                            <div key={msg.id} className={`chat-message ${msg.role} ${msg.isError ? 'error' : ''}`}>
                                <div className="message-content" dangerouslySetInnerHTML={{ __html: marked.parse(msg.text) }}></div>
                            </div>
                        ))}
                        {isLoading && (
                            <div className="chat-message model">
                                <div className="message-content"><LoadingSpinnerSm /></div>
                            </div>
                        )}
                    </div>
                    <form className="chatbot-input" onSubmit={handleSend}>
                        <input
                            type="text"
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            placeholder="Ask me anything..."
                            disabled={isLoading}
                            aria-label="Chat input"
                        />
                        <button type="submit" disabled={isLoading || !input.trim()} aria-label="Send message">
                            {Icons.send}
                        </button>
                    </form>
                </div>
            )}
        </>
    );
};


// --- Dashboard Components ---
const DashboardView: React.FC<{
    currentUser: User;
    users: User[];
    timetableEntries: TimetableEntry[];
    leaveRequests: LeaveRequest[];
    announcements: Announcement[];
    resourceRequests: ResourceRequest[];
    deadlines: Deadline[];
    setView: (view: AppView) => void;
    timeSlots: string[];
}> = (props) => {
    switch (props.currentUser.role) {
        case 'admin':
            return <AdminDashboard {...props} />;
        case 'hod':
            return <HodDashboard {...props} />;
        case 'faculty':
        case 'class advisor':
            return <FacultyDashboard {...props} />;
        case 'student':
            return <StudentDashboard {...props} />;
        default:
             return <GenericDashboard {...props} />;
    }
};

const GenericDashboard: React.FC<{currentUser: User; timeSlots: string[]; timetableEntries: TimetableEntry[], deadlines: Deadline[]}> = ({currentUser, timeSlots, timetableEntries, deadlines}) => {
    const today = DAYS[new Date().getDay() - 1] || 'Monday';
    const userSchedule = timetableEntries.filter(entry => {
        if(currentUser.role === 'student') {
            // A student sees their own classes plus common entries for everyone
            return entry.day === today && (
                (entry.department === currentUser.dept && entry.year === currentUser.year) ||
                (entry.department === 'all' && entry.year === 'all')
            );
        }
        if(currentUser.role === 'faculty' || currentUser.role === 'class advisor' || currentUser.role === 'hod') {
             // Faculty only sees classes they are assigned to
            return entry.day === today && entry.faculty === currentUser.name;
        }
        return false;
    }).sort((a, b) => a.timeIndex - b.timeIndex);

    const relevantDeadlines = deadlines.filter(d => d.audience.includes('all') || d.audience.includes(currentUser.role));

     return (
        <div className="dashboard-container">
            <h2 className="dashboard-greeting">Welcome, {currentUser.name}!</h2>
            <div className="dashboard-grid">
                <div className="dashboard-card">
                    <h3>Today's Schedule ({today})</h3>
                    {userSchedule.length > 0 ? (
                         <ul className="schedule-list">
                            {userSchedule.map(item => (
                                <li key={item.id} className={`schedule-item ${item.type}`}>
                                    <span className="time">{timeSlots[item.timeIndex]}</span>
                                    <span className="subject">{item.subject}</span>
                                    {currentUser.role === 'student' && <span className="faculty">{item.faculty || 'N/A'}</span>}
                                    {currentUser.role !== 'student' && <span>{item.department} {item.year}</span>}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="no-history-text">No classes scheduled for today.</p>
                    )}
                </div>
                <div className="dashboard-card">
                    <h3>Upcoming Deadlines</h3>
                     {relevantDeadlines.length > 0 ? (
                        <ul className="deadline-list">
                            {relevantDeadlines.slice(0,4).map(d => (
                                <li key={d.id}>
                                    <span className="deadline-title">{d.title}</span>
                                    <span className="deadline-date">{new Date(d.dueDate).toLocaleDateString()}</span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="no-history-text">No upcoming deadlines.</p>
                    )}
                </div>
            </div>
        </div>
    );
}

const StudentDashboard: React.FC<{currentUser: User; timeSlots: string[]; timetableEntries: TimetableEntry[]; deadlines: Deadline[];}> = (props) => {
    const { currentUser } = props;
    const averageGrade = useMemo(() => {
        if (!currentUser.grades || currentUser.grades.length === 0) return 'N/A';
        const total = currentUser.grades.reduce((sum, g) => sum + g.score, 0);
        return (total / currentUser.grades.length).toFixed(1);
    }, [currentUser.grades]);

    const attendancePercentage = useMemo(() => {
        if (!currentUser.attendance || currentUser.attendance.total === 0) return 'N/A';
        return ((currentUser.attendance.present / currentUser.attendance.total) * 100).toFixed(1) + '%';
    }, [currentUser.attendance]);

    return (
        <div className="dashboard-container">
            <GenericDashboard {...props} />
             <div className="dashboard-grid">
                <div className="dashboard-card">
                    <h3>Academic Progress</h3>
                    <div className="stat-card-grid">
                         <StatCard icon={Icons.academicCap} title="Average Grade" value={averageGrade} />
                         <StatCard icon={Icons.checkCircle} title="Attendance" value={attendancePercentage} />
                    </div>
                </div>
            </div>
        </div>
    )
}

const FacultyDashboard: React.FC<{currentUser: User; setView: (view: AppView) => void; timeSlots: string[]; timetableEntries: TimetableEntry[]; deadlines: Deadline[];}> = (props) => {
     return (
        <div className="dashboard-container">
            <GenericDashboard {...props} />
             <div className="dashboard-grid">
                <div className="dashboard-card">
                    <h3>Quick Actions</h3>
                    <div className="quick-actions-grid">
                        <button onClick={() => props.setView('studentDirectory')} className="quick-action-btn">{Icons.users} Student Directory</button>
                        <button onClick={() => props.setView('announcements')} className="quick-action-btn">{Icons.announcement} View Announcements</button>
                    </div>
                </div>
            </div>
        </div>
    )
}

const HodDashboard: React.FC<{
    currentUser: User;
    users: User[];
    timetableEntries: TimetableEntry[];
    leaveRequests: LeaveRequest[];
    deadlines: Deadline[];
    setView: (view: AppView) => void;
}> = ({ currentUser, users, timetableEntries, leaveRequests, deadlines, setView }) => {
    const deptEntries = useMemo(() => timetableEntries.filter(e => e.department === currentUser.dept), [timetableEntries, currentUser.dept]);
    const deptFaculty = useMemo(() => users.filter(u => u.role === 'faculty' && u.dept === currentUser.dept), [users, currentUser.dept]);
    const deptLeaveRequests = useMemo(() => leaveRequests.filter(lr => deptFaculty.some(f => f.id === lr.facultyId)), [leaveRequests, deptFaculty]);

    const stats = useMemo(() => {
        const conflicts = findScheduleConflicts(deptEntries);
        return {
            totalFaculty: deptFaculty.length,
            activeCourses: new Set(deptEntries.filter(t => t.type === 'class').map(t => t.subject)).size,
            pendingLeave: deptLeaveRequests.filter(r => r.status === 'pending').length,
            scheduleConflicts: conflicts.length
        };
    }, [deptFaculty, deptEntries, deptLeaveRequests]);
    
    return (
        <div className="dashboard-container">
            <h2 className="dashboard-greeting">Welcome, {currentUser.name} (HOD, {currentUser.dept})!</h2>
             <div className="stat-card-grid">
                <StatCard icon={Icons.users} title="Department Faculty" value={stats.totalFaculty.toString()} />
                <StatCard icon={Icons.clipboardList} title="Department Courses" value={stats.activeCourses.toString()} />
                <StatCard icon={Icons.approvals} title="Pending Leave" value={stats.pendingLeave.toString()} />
                <StatCard icon={Icons.warning} title="Schedule Conflicts" value={stats.scheduleConflicts.toString()} type={stats.scheduleConflicts > 0 ? 'danger' : 'success'} />
            </div>
            <div className="dashboard-grid">
                 <div className="dashboard-card">
                    <h3>Pending Leave Requests</h3>
                    {stats.pendingLeave > 0 ? (
                        <ul className="schedule-list">
                            {deptLeaveRequests.filter(lr => lr.status === 'pending').slice(0, 4).map(lr => (
                                <li key={lr.id} className="schedule-item">
                                    <span className="subject">{lr.facultyName}</span>
                                    <span>{lr.day}</span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="no-history-text">No pending leave requests.</p>
                    )}
                 </div>
                 <div className="dashboard-card">
                    <h3>Upcoming Deadlines</h3>
                    <ul className="deadline-list">
                        {deadlines.filter(d => d.audience.includes('hod') || d.audience.includes('faculty')).slice(0,4).map(d => (
                            <li key={d.id}>
                                <span className="deadline-title">{d.title}</span>
                                <span className="deadline-date">{new Date(d.dueDate).toLocaleDateString()}</span>
                            </li>
                        ))}
                    </ul>
                 </div>
                 <div className="dashboard-card">
                    <h3>Quick Actions</h3>
                    <div className="quick-actions-grid">
                        <button onClick={() => setView('approvals')} className="quick-action-btn">{Icons.approvals} Review Approvals</button>
                        <button onClick={() => setView('studentDirectory')} className="quick-action-btn">{Icons.users} Student Directory</button>
                    </div>
                 </div>
            </div>
        </div>
    )
}

const AdminDashboard: React.FC<{
    users: User[];
    timetableEntries: TimetableEntry[];
    leaveRequests: LeaveRequest[];
    deadlines: Deadline[];
    setView: (view: AppView) => void;
    timeSlots: string[];
}> = ({ users, timetableEntries, leaveRequests, deadlines, setView, timeSlots }) => {
    const today = DAYS[new Date().getDay() -1] || 'Monday';

    const stats = useMemo(() => {
        const conflicts = findScheduleConflicts(timetableEntries);
        return {
            totalUsers: users.length,
            activeCourses: new Set(timetableEntries.filter(t => t.type === 'class').map(t => t.subject)).size,
            facultyOnLeave: leaveRequests.filter(r => r.day === today && r.status === 'approved').length,
            scheduleConflicts: conflicts.length
        };
    }, [users, timetableEntries, leaveRequests, today]);
    
    const unassignedClasses = useMemo(() => timetableEntries.filter(e => e.type === 'class' && !e.faculty), [timetableEntries]);
    const pendingApprovals = useMemo(() => users.filter(u => u.status === 'pending_approval'), [users]);
    const scheduleConflicts = useMemo(() => findScheduleConflicts(timetableEntries), [timetableEntries]);

    const facultyOnLeave = useMemo(() => {
        const onLeaveIds = new Set(leaveRequests.filter(r => r.day === today && r.status === 'approved').map(r => r.facultyId));
        return users.filter(u => onLeaveIds.has(u.id));
    }, [leaveRequests, users, today]);

    const facultyTeachingNow = useMemo(() => {
        const now = new Date();
        const currentHour = now.getHours();
        const currentTimeSlotIndex = timeSlots.findIndex(slot => {
            const startHour = parseInt(slot.split(':')[0]);
            return currentHour === startHour;
        });
        if(currentTimeSlotIndex === -1) return [];

        const teachingNowEntries = timetableEntries.filter(e => e.day === today && e.timeIndex === currentTimeSlotIndex && e.faculty);
        return Array.from(new Set(teachingNowEntries.map(e => e.faculty!)));

    }, [timeSlots, timetableEntries, today]);
    
    const todaysSchedule = useMemo(() => timetableEntries.filter(e => e.day === today).sort((a, b) => a.timeIndex - b.timeIndex), [timetableEntries, today]);

    return (
        <div className="dashboard-container">
             <div className="stat-card-grid">
                <StatCard icon={Icons.users} title="Total Users" value={stats.totalUsers.toString()} />
                <StatCard icon={Icons.clipboardList} title="Active Courses" value={stats.activeCourses.toString()} />
                <StatCard icon={Icons.guardian} title="Faculty on Leave" value={stats.facultyOnLeave.toString()} />
                <StatCard icon={Icons.warning} title="Schedule Conflicts" value={stats.scheduleConflicts.toString()} type={stats.scheduleConflicts > 0 ? 'danger' : 'success'} />
            </div>
            <div className="dashboard-grid admin-dashboard-grid">
                <div className="dashboard-card full-width">
                     <h3>System Alerts</h3>
                     <div className="alert-widget-grid">
                        <div className="alert-item-widget">
                            <h4>Unassigned Classes ({unassignedClasses.length})</h4>
                            {unassignedClasses.length > 0 ? <ul>{unassignedClasses.slice(0,3).map(e => <li key={e.id}>{e.subject} ({e.department} {e.year})</li>)}</ul> : <p>None</p>}
                        </div>
                         <div className="alert-item-widget">
                            <h4>Pending Approvals ({pendingApprovals.length})</h4>
                            {pendingApprovals.length > 0 ? <ul>{pendingApprovals.slice(0,3).map(u => <li key={u.id}>{u.name} ({u.role})</li>)}</ul> : <p>None</p>}
                        </div>
                        <div className="alert-item-widget">
                            <h4>Schedule Conflicts ({scheduleConflicts.length})</h4>
                            {scheduleConflicts.length > 0 ? <ul>{scheduleConflicts.slice(0,3).map(c => <li key={c.identifier}>{c.type} - {c.identifier}</li>)}</ul> : <p>None</p>}
                        </div>
                     </div>
                </div>
                 <div className="dashboard-card">
                    <h3>Today's Schedule</h3>
                    <ul className="schedule-list dense">
                        {todaysSchedule.slice(0, 5).map(item => (
                             <li key={item.id} className={`schedule-item ${item.type}`}>
                                <span className="time">{timeSlots[item.timeIndex]}</span>
                                <div>
                                    <span className="subject">{item.subject}</span>
                                    <span className="faculty">{item.type === 'class' ? `${item.department} ${item.year}` : ''}</span>
                                </div>
                                <span className="room">{item.room || 'N/A'}</span>
                            </li>
                        ))}
                    </ul>
                 </div>
                 <div className="dashboard-card">
                    <h3>Faculty Status</h3>
                     <h4>On Leave Today ({facultyOnLeave.length})</h4>
                     {facultyOnLeave.length > 0 ? <p className="faculty-status-list">{facultyOnLeave.map(f => f.name).join(', ')}</p> : <p className="no-history-text">No faculty on leave.</p>}
                     <h4 style={{marginTop: '1rem'}}>Teaching Now ({facultyTeachingNow.length})</h4>
                     {facultyTeachingNow.length > 0 ? <p className="faculty-status-list">{facultyTeachingNow.join(', ')}</p> : <p className="no-history-text">No classes currently in session.</p>}
                 </div>
                 <div className="dashboard-card">
                    <h3>Upcoming Deadlines</h3>
                    <ul className="deadline-list">
                        {deadlines.slice(0,4).map(d => (
                            <li key={d.id}>
                                <span className="deadline-title">{d.title}</span>
                                <span className="deadline-date">{new Date(d.dueDate).toLocaleDateString()}</span>
                            </li>
                        ))}
                    </ul>
                 </div>
                 <div className="dashboard-card">
                    <h3>Quick Actions</h3>
                    <div className="quick-actions-grid">
                        <button onClick={() => setView('manage')} className="quick-action-btn">{Icons.edit} Manage Timetable</button>
                        <button onClick={() => setView('userManagement')} className="quick-action-btn">{Icons.users} Manage Users</button>
                        <button onClick={() => setView('approvals')} className="quick-action-btn">{Icons.approvals} Review Approvals</button>
                        <button onClick={() => setView('security')} className="quick-action-btn">{Icons.security} Security Center</button>
                    </div>
                 </div>
            </div>
        </div>
    );
};

const StatCard: React.FC<{ icon: JSX.Element; title: string; value: string; type?: 'default' | 'danger' | 'success' }> = ({ icon, title, value, type = 'default' }) => (
    <div className={`stat-card ${type}`}>
        <div className="stat-icon">{icon}</div>
        <div className="stat-info">
            <p className="stat-title">{title}</p>
            <p className="stat-value">{value}</p>
        </div>
    </div>
);

// --- FULLY IMPLEMENTED VIEWS ---

const TimetableView: React.FC<{
    timetableEntries: TimetableEntry[];
    timeSlots: string[];
    setLeaveRequests: React.Dispatch<React.SetStateAction<LeaveRequest[]>>;
}> = ({ timetableEntries, timeSlots, setLeaveRequests }) => {
    const { currentUser, addNotification } = useAppContext();
    const [department, setDepartment] = useState(currentUser?.dept === 'all' ? DEPARTMENTS[0] : currentUser?.dept || DEPARTMENTS[0]);
    const [year, setYear] = useState(currentUser?.year || YEARS[0]);
    const [isLeaveModalOpen, setLeaveModalOpen] = useState(false);
    const [selectedEntry, setSelectedEntry] = useState<TimetableEntry | null>(null);
    const [leaveReason, setLeaveReason] = useState('');

    const handleCellClick = (entry: TimetableEntry) => {
        if (currentUser?.role === 'faculty' && entry.faculty === currentUser.name && entry.type === 'class') {
            setSelectedEntry(entry);
            setLeaveModalOpen(true);
        }
    };

    const handleRequestLeave = (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedEntry || !currentUser) return;
        const newRequest: LeaveRequest = {
            id: uuidv4(),
            facultyId: currentUser.id,
            facultyName: currentUser.name,
            timetableEntryId: selectedEntry.id,
            day: selectedEntry.day,
            timeIndex: selectedEntry.timeIndex,
            status: 'pending',
            reason: leaveReason,
            timestamp: Date.now(),
        };
        setLeaveRequests(prev => [...prev, newRequest]);
        addNotification('Leave request submitted successfully.', 'success');
        setLeaveModalOpen(false);
        setLeaveReason('');
        setSelectedEntry(null);
    };

    const filteredEntries = timetableEntries.filter(entry =>
        entry.type !== 'class' || (entry.department === department && entry.year === year)
    );

    return (
        <div className="timetable-container">
             <Modal isOpen={isLeaveModalOpen} onClose={() => setLeaveModalOpen(false)} title="Request Leave">
                <form onSubmit={handleRequestLeave}>
                    {selectedEntry && (
                        <div className="control-group" style={{marginBottom: '1rem'}}>
                            <p><strong>Class:</strong> {selectedEntry.subject}</p>
                            <p><strong>Time:</strong> {selectedEntry.day}, {timeSlots[selectedEntry.timeIndex]}</p>
                        </div>
                    )}
                    <div className="control-group">
                        <label htmlFor="leave-reason">Reason (Optional)</label>
                        <textarea
                            id="leave-reason"
                            className="form-control"
                            value={leaveReason}
                            onChange={e => setLeaveReason(e.target.value)}
                            rows={3}
                        />
                    </div>
                    <div className="form-actions" style={{marginTop: '1rem'}}>
                        <button type="button" className="btn btn-secondary" onClick={() => setLeaveModalOpen(false)}>Cancel</button>
                        <button type="submit" className="btn btn-primary">Submit Request</button>
                    </div>
                </form>
            </Modal>
            <div className="timetable-header">
                <h3>Class Schedule</h3>
                <div className="timetable-controls">
                    <select className="form-control" value={department} onChange={e => setDepartment(e.target.value)} disabled={currentUser?.role === 'student' || currentUser?.role === 'faculty'}>
                        {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <select className="form-control" value={year} onChange={e => setYear(e.target.value)} disabled={currentUser?.role === 'student'}>
                        {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                </div>
            </div>
            <div className="timetable-wrapper">
                <div className="timetable-grid">
                    <div className="grid-header">Time</div>
                    {DAYS.map(day => <div key={day} className="grid-header">{day}</div>)}

                    {timeSlots.map((slot, timeIndex) => (
                        <React.Fragment key={timeIndex}>
                            <div className="time-slot">{slot}</div>
                            {DAYS.map(day => {
                                const entry = filteredEntries.find(e => e.day === day && e.timeIndex === timeIndex);
                                const isUserClass = entry?.faculty === currentUser?.name || (entry?.department === currentUser?.dept && entry?.year === currentUser?.year);
                                const canRequestLeave = currentUser?.role === 'faculty' && entry?.faculty === currentUser?.name;

                                return (
                                    <div key={day} className={`grid-cell ${entry?.type || ''} ${isUserClass ? 'is-user-class' : ''} ${canRequestLeave ? 'can-request-leave' : ''}`} onClick={() => entry && handleCellClick(entry)}>
                                        {entry ? (
                                            <>
                                                <span className="subject">{entry.subject}</span>
                                                {entry.faculty && <span className="faculty">{entry.faculty}</span>}
                                            </>
                                        ) : null}
                                    </div>
                                );
                            })}
                        </React.Fragment>
                    ))}
                </div>
            </div>
        </div>
    );
};

const ManageTimetableView: React.FC<{
    timetableEntries: TimetableEntry[];
    setTimetableEntries: React.Dispatch<React.SetStateAction<TimetableEntry[]>>;
    timeSlots: string[];
    users: User[];
}> = ({ timetableEntries, setTimetableEntries, timeSlots, users }) => {
    const [formData, setFormData] = useState<ManageFormData>({
        department: 'CSE', year: 'I', day: 'Monday', timeIndex: 0, subject: '', type: 'class'
    });
    const [editingId, setEditingId] = useState<string | null>(null);
    const { addNotification } = useAppContext();
    const facultyList = users.filter(u => u.role === 'faculty' || u.role === 'hod');

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => {
            const newState = { ...prev, [name]: name === 'timeIndex' ? parseInt(value) : value };
            if (name === 'type') {
                if (value !== 'class') {
                    // For breaks or common hours, department and year should be 'all'
                    newState.department = 'all';
                    newState.year = 'all';
                } else {
                    // If switching back to 'class', reset to a sensible default if it was 'all' before
                    if (prev.department === 'all') {
                       newState.department = 'CSE';
                       newState.year = 'I';
                    }
                }
            }
            return newState;
        });
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.subject && (formData.type === 'class' || formData.type === 'common')) {
            addNotification('Subject cannot be empty for classes.', 'error');
            return;
        }

        if (editingId) {
            setTimetableEntries(prev => prev.map(entry => entry.id === editingId ? { ...entry, ...formData } : entry));
            addNotification('Entry updated successfully.', 'success');
        } else {
            const newEntry = { id: uuidv4(), ...formData };
            setTimetableEntries(prev => [...prev, newEntry]);
            addNotification('Entry added successfully.', 'success');
        }
        handleClear();
    };

    const handleEdit = (entry: TimetableEntry) => {
        setEditingId(entry.id);
        setFormData(entry);
    };

    const handleDelete = (id: string) => {
        if (window.confirm('Are you sure you want to delete this entry?')) {
            setTimetableEntries(prev => prev.filter(entry => entry.id !== id));
            addNotification('Entry deleted successfully.', 'success');
        }
    };

    const handleClear = () => {
        setEditingId(null);
        setFormData({ department: 'CSE', year: 'I', day: 'Monday', timeIndex: 0, subject: '', type: 'class' });
    };

    return (
        <div className="manage-timetable-container">
            <form className="entry-form" onSubmit={handleSubmit}>
                <h3>{editingId ? 'Edit Timetable Entry' : 'Add New Entry'}</h3>
                <div className="form-grid">
                    <div className="control-group">
                        <label>Department</label>
                        <select name="department" value={formData.department} onChange={handleInputChange} className="form-control" disabled={formData.type !== 'class'}>
                            {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                             <option value="all">Common</option>
                        </select>
                    </div>
                     <div className="control-group">
                        <label>Year</label>
                        <select name="year" value={formData.year} onChange={handleInputChange} className="form-control" disabled={formData.type !== 'class'}>
                            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                            <option value="all">Common</option>
                        </select>
                    </div>
                    <div className="control-group">
                        <label>Day</label>
                        <select name="day" value={formData.day} onChange={handleInputChange} className="form-control">
                            {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                    </div>
                    <div className="control-group">
                        <label>Time Slot</label>
                        <select name="timeIndex" value={formData.timeIndex} onChange={handleInputChange} className="form-control">
                            {timeSlots.map((ts, i) => <option key={i} value={i}>{ts}</option>)}
                        </select>
                    </div>
                     <div className="control-group">
                        <label>Type</label>
                        <select name="type" value={formData.type} onChange={handleInputChange} className="form-control">
                            <option value="class">Class</option>
                            <option value="break">Break</option>
                            <option value="common">Common Hour</option>
                        </select>
                    </div>
                    <div className="control-group">
                        <label>Subject</label>
                        <input type="text" name="subject" value={formData.subject} onChange={handleInputChange} className="form-control" />
                    </div>
                    <div className="control-group">
                        <label>Faculty</label>
                        <select name="faculty" value={formData.faculty || ''} onChange={handleInputChange} className="form-control" disabled={formData.type !== 'class'}>
                            <option value="">Unassigned</option>
                            {facultyList.map(f => <option key={f.id} value={f.name}>{f.name} ({f.dept})</option>)}
                        </select>
                    </div>
                    <div className="control-group">
                        <label>Room No.</label>
                        <input type="text" name="room" value={formData.room || ''} onChange={handleInputChange} className="form-control" />
                    </div>
                </div>
                <div className="form-actions">
                    <button type="button" className="btn btn-secondary" onClick={handleClear}>Clear</button>
                    <button type="submit" className="btn btn-primary">{editingId ? 'Update Entry' : 'Add Entry'}</button>
                </div>
            </form>

            <div className="entry-list-container">
                 <h3>Existing Entries</h3>
                 <table className="entry-list-table">
                     <thead>
                         <tr>
                             <th>Day</th>
                             <th>Time</th>
                             <th>Class</th>
                             <th>Subject</th>
                             <th>Faculty</th>
                             <th>Actions</th>
                         </tr>
                     </thead>
                     <tbody>
                         {timetableEntries.slice().sort((a,b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.timeIndex - b.timeIndex).map(entry => (
                             <tr key={entry.id}>
                                 <td>{entry.day}</td>
                                 <td>{timeSlots[entry.timeIndex]}</td>
                                 <td>
                                     {entry.type === 'class' 
                                        ? `${entry.department.toUpperCase()} - ${entry.year}`
                                        : <span style={{ color: 'var(--text-secondary)'}}>Common</span>
                                    }
                                 </td>
                                 <td>{entry.subject}</td>
                                 <td>{entry.faculty || 'N/A'}</td>
                                 <td className="entry-actions">
                                     <button onClick={() => handleEdit(entry)} title="Edit">{Icons.editPencil}</button>
                                     <button onClick={() => handleDelete(entry.id)} title="Delete" className="delete-btn">{Icons.delete}</button>
                                 </td>
                             </tr>
                         ))}
                     </tbody>
                 </table>
            </div>
        </div>
    );
};

const SettingsView: React.FC<{
    timeSlots: string[];
    setTimeSlots: React.Dispatch<React.SetStateAction<string[]>>;
}> = ({ timeSlots, setTimeSlots }) => {
    const [newTimeSlot, setNewTimeSlot] = useState('');
    const { addNotification } = useAppContext();

    const handleUpdate = (index: number, value: string) => {
        const updated = [...timeSlots];
        updated[index] = value;
        setTimeSlots(updated);
    };
    
    const handleDelete = (index: number) => {
        setTimeSlots(prev => prev.filter((_, i) => i !== index));
    };

    const handleAdd = (e: React.FormEvent) => {
        e.preventDefault();
        if(newTimeSlot.trim()) {
            setTimeSlots(prev => [...prev, newTimeSlot.trim()]);
            setNewTimeSlot('');
            addNotification("Time slot added.", "success");
        }
    };

    return (
        <div className="settings-container">
            <h2>Application Settings</h2>
            <div className="settings-card">
                <h3>Manage Time Slots</h3>
                <ul className="timeslot-list">
                    {timeSlots.map((slot, index) => (
                        <li key={index} className="timeslot-item">
                            <input type="text" value={slot} onChange={e => handleUpdate(index, e.target.value)} className="form-control" />
                             <div className="item-actions">
                                <button onClick={() => handleDelete(index)} className="delete-btn">{Icons.delete}</button>
                            </div>
                        </li>
                    ))}
                </ul>
                <form className="add-timeslot-form" onSubmit={handleAdd}>
                    <input
                        type="text"
                        value={newTimeSlot}
                        onChange={e => setNewTimeSlot(e.target.value)}
                        placeholder="e.g., 4:00 - 5:00"
                        className="form-control"
                    />
                    <button type="submit" className="btn btn-primary">{Icons.add} Add</button>
                </form>
            </div>
        </div>
    );
};

const StudentDirectoryView: React.FC<{ users: User[] }> = ({ users }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [department, setDepartment] = useState('all');
    const [year, setYear] = useState('all');

    const students = users.filter(u => u.role === 'student');

    const filteredStudents = students.filter(student =>
        student.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
        (department === 'all' || student.dept === department) &&
        (year === 'all' || student.year === year)
    );

    return (
        <div className="user-management-container">
            <div className="directory-header">
                <h2>Student Directory</h2>
                <div className="directory-controls timetable-controls">
                    <input
                        type="text"
                        placeholder="Search by name..."
                        className="form-control"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                    <select className="form-control" value={department} onChange={e => setDepartment(e.target.value)}>
                        <option value="all">All Departments</option>
                        {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                     <select className="form-control" value={year} onChange={e => setYear(e.target.value)}>
                        <option value="all">All Years</option>
                        {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                </div>
            </div>
            <div className="entry-list-container">
                <table className="entry-list-table user-management-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Department</th>
                            <th>Year</th>
                            <th>Avg. Grade</th>
                            <th>Attendance</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredStudents.map(student => (
                            <tr key={student.id}>
                                <td>{student.name}</td>
                                <td>{student.dept}</td>
                                <td>{student.year}</td>
                                <td>{student.grades && student.grades.length > 0 ? (student.grades.reduce((a, b) => a + b.score, 0) / student.grades.length).toFixed(1) : 'N/A'}</td>
                                <td>{student.attendance ? `${((student.attendance.present / student.attendance.total) * 100).toFixed(0)}%` : 'N/A'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                 {filteredStudents.length === 0 && <p className="no-history-text">No students found matching your criteria.</p>}
            </div>
        </div>
    );
};

const ApprovalsView: React.FC<{
    leaveRequests: LeaveRequest[];
    setLeaveRequests: React.Dispatch<React.SetStateAction<LeaveRequest[]>>;
    users: User[];
    setUsers: React.Dispatch<React.SetStateAction<User[]>>;
    timetableEntries: TimetableEntry[];
    timeSlots: string[];
    canApprove: (item: LeaveRequest | User) => boolean;
}> = ({ leaveRequests, setLeaveRequests, users, setUsers, timetableEntries, timeSlots, canApprove }) => {
    const { currentUser, addNotification } = useAppContext();
    const [activeTab, setActiveTab] = useState<'leave' | 'users'>('leave');
    const [isGenerating, setIsGenerating] = useState<string | null>(null);

    const pendingLeaveRequests = leaveRequests.filter(r => r.status === 'pending');
    const pendingUsers = users.filter(u => u.status === 'pending_approval');

    const handleLeaveResponse = (id: string, status: 'approved' | 'rejected') => {
        setLeaveRequests(prev => prev.map(r => r.id === id ? { ...r, status } : r));
        addNotification(`Leave request ${status}.`, status === 'approved' ? 'success' : 'warning');
    };
    
    const handleUserResponse = (id: string, status: 'active' | 'rejected') => {
        setUsers(prev => prev.map(u => u.id === id ? { ...u, status } : u));
        addNotification(`User registration ${status === 'active' ? 'approved' : 'rejected'}.`, status === 'active' ? 'success' : 'warning');
    };

    const handleAISuggestion = async (request: LeaveRequest) => {
        if (!ai) {
            addNotification("AI features are not enabled.", "error");
            return;
        }
        setIsGenerating(request.id);
        try {
            const requestEntry = timetableEntries.find(e => e.id === request.timetableEntryId);
            if (!requestEntry) throw new Error("Could not find timetable entry for request");

            const sameDeptFaculty = users.filter(u => u.role === 'faculty' && u.dept === requestEntry.department && u.id !== request.facultyId);
            const busyFaculty = new Set(timetableEntries.filter(e => e.day === request.day && e.timeIndex === request.timeIndex && e.faculty).map(e => e.faculty));
            const availableFaculty = sameDeptFaculty.filter(f => !busyFaculty.has(f.name));

            const prompt = `The faculty member ${request.facultyName} has requested leave for their ${requestEntry.subject} class (${requestEntry.department} Dept) on ${request.day}.
            The following faculty from the same department are available at that time:
            ${availableFaculty.map(f => `- ${f.name} (Specializations: ${f.specialization?.join(', ') || 'N/A'})`).join('\n')}
            
            Based on the subject and faculty specializations, who is the best substitute? Provide a very brief, one-sentence recommendation and justification. Example: "Recommend Dr. John Doe due to his expertise in Algorithms."`;
            
            const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
            setLeaveRequests(prev => prev.map(r => r.id === request.id ? { ...r, aiSuggestion: response.text } : r));
        } catch (error) {
            console.error("AI suggestion failed:", error);
            addNotification("Failed to get AI suggestion.", "error");
        } finally {
            setIsGenerating(null);
        }
    };


    return (
        <div className="approvals-container">
            <div className="tabs">
                <button className={`tab-button ${activeTab === 'leave' ? 'active' : ''}`} onClick={() => setActiveTab('leave')}>Leave Requests ({pendingLeaveRequests.filter(canApprove).length})</button>
                <button className={`tab-button ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>New Users ({pendingUsers.filter(canApprove).length})</button>
            </div>
            <div className="tab-content">
                {activeTab === 'leave' && (
                    <div className="approval-list">
                        {pendingLeaveRequests.filter(canApprove).map(req => {
                             const entry = timetableEntries.find(e => e.id === req.timetableEntryId);
                             return (
                                <div key={req.id} className="approval-card">
                                    <div className="approval-card-main">
                                        <h4>{req.facultyName}</h4>
                                        <p><strong>Class:</strong> {entry?.subject || 'N/A'}</p>
                                        <p><strong>Time:</strong> {req.day}, {entry ? timeSlots[entry.timeIndex] : 'N/A'}</p>
                                        <p><strong>Reason:</strong> {req.reason || 'Not provided'}</p>
                                        <small>Requested {getRelativeTime(req.timestamp)}</small>
                                    </div>
                                    <div className="approval-card-ai">
                                        <h5>{Icons.lightbulb} AI Assistance</h5>
                                        {req.aiSuggestion ? (
                                            <p className="ai-suggestion">{req.aiSuggestion}</p>
                                        ) : (
                                            <button className="btn btn-secondary btn-sm" onClick={() => handleAISuggestion(req)} disabled={isGenerating === req.id}>
                                                {isGenerating === req.id ? <LoadingSpinnerSm /> : 'Suggest Substitute'}
                                            </button>
                                        )}
                                    </div>
                                    <div className="approval-card-actions">
                                        <button className="btn btn-danger" onClick={() => handleLeaveResponse(req.id, 'rejected')}>Reject</button>
                                        <button className="btn btn-success" onClick={() => handleLeaveResponse(req.id, 'approved')}>Approve</button>
                                    </div>
                                </div>
                             )
                        })}
                        {pendingLeaveRequests.filter(canApprove).length === 0 && <p className="no-history-text">No pending leave requests.</p>}
                    </div>
                )}
                {activeTab === 'users' && (
                    <div className="approval-list">
                        {pendingUsers.filter(canApprove).map(user => (
                            <div key={user.id} className="approval-card">
                                <div className="approval-card-main">
                                    <h4>{user.name}</h4>
                                    <p><strong>Role:</strong> {user.role}</p>
                                    <p><strong>Department:</strong> {user.dept}</p>
                                    {user.year && <p><strong>Year:</strong> {user.year}</p>}
                                </div>
                                <div className="approval-card-ai">
                                    <h5>{Icons.lightbulb} AI Assessment</h5>
                                    <p className="ai-assessment">{user.aiAssessment || 'Not available.'}</p>
                                </div>
                                <div className="approval-card-actions">
                                    <button className="btn btn-danger" onClick={() => handleUserResponse(user.id, 'rejected')}>Reject</button>
                                    <button className="btn btn-success" onClick={() => handleUserResponse(user.id, 'active')}>Approve</button>
                                </div>
                            </div>
                        ))}
                         {pendingUsers.filter(canApprove).length === 0 && <p className="no-history-text">No pending user registrations.</p>}
                    </div>
                )}
            </div>
        </div>
    );
};

const OnboardingGuide: React.FC<{ user: User, onFinish: () => void }> = ({ user, onFinish }) => {
    const [isWelcomeVisible, setIsWelcomeVisible] = useState(true);
    const [isTourActive, setIsTourActive] = useState(false);
    const [steps, setSteps] = useState<OnboardingStep[]>([]);
    const [currentStep, setCurrentStep] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
    const { addNotification } = useAppContext();

    const generateOnboardingSteps = useCallback(async () => {
        if (!ai) {
            addNotification("AI Assistant is not available to start the tour.", "error");
            onFinish();
            return;
        }
        setIsLoading(true);

        let roleSpecificSelectors = '';
        switch(user.role) {
            case 'admin':
                roleSpecificSelectors = `- "[data-view='userManagement']": The user management link.\n- "[data-view='security']": The security center link.`;
                break;
            case 'hod':
                roleSpecificSelectors = `- "[data-view='approvals']": The approvals link for leave requests.`;
                break;
            case 'student':
                 roleSpecificSelectors = `- "[data-view='announcements']": The announcements link.`;
                 break;
        }

        const prompt = `You are a friendly and helpful onboarding assistant for a college management app called 'AcademiBot'.
        A new ${user.role} named ${user.name} has just logged in for the first time.
        Generate a short and clear onboarding tour for them. The tour should consist of 4 to 5 steps.
        Return your response as a valid JSON array of objects. Each object must have two keys:
        1. "target": A CSS selector for the element to highlight.
        2. "content": A brief, friendly explanation of what the element does (max 2-3 sentences).

        Here are the available CSS selectors and what they represent:
        - "[data-view='dashboard']": The main dashboard link.
        - "[data-view='timetable']": The class timetable link.
        - ".user-info": The user's name and role display.
        - ".theme-toggle": The button to switch between light and dark mode.
        - ".chatbot-fab": The floating button to open the AI Assistant.
        ${roleSpecificSelectors}

        Tailor the content of the steps to be most relevant for a ${user.role}. Start with a general welcome.`;

        try {
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: { responseMimeType: "application/json" }
            });
            const parsedSteps = JSON.parse(response.text);
            if (Array.isArray(parsedSteps) && parsedSteps.length > 0) {
                setSteps(parsedSteps);
                setCurrentStep(0);
                setIsTourActive(true);
            } else {
                throw new Error("Invalid response format from AI.");
            }
        } catch (error) {
            console.error("Failed to generate onboarding steps:", error);
            addNotification("Could not start the AI-powered tour. We'll skip it for now.", "error");
            onFinish();
        } finally {
            setIsLoading(false);
        }
    }, [user, addNotification, onFinish]);

    const handleStartTour = () => {
        setIsWelcomeVisible(false);
        generateOnboardingSteps();
    };

    const handleNext = () => {
        if (currentStep < steps.length - 1) {
            setCurrentStep(prev => prev + 1);
        } else {
            handleFinish();
        }
    };
    
    const handlePrev = () => {
        if (currentStep > 0) {
            setCurrentStep(prev => prev - 1);
        }
    };

    const handleFinish = () => {
        setIsTourActive(false);
        onFinish();
    };

    useEffect(() => {
        if (isTourActive && steps[currentStep]) {
            const updatePosition = () => {
                const targetElement = document.querySelector(steps[currentStep].target);
                if (targetElement) {
                    setTargetRect(targetElement.getBoundingClientRect());
                } else {
                    // if target not found, skip to next step or end
                    handleNext();
                }
            };
            updatePosition();
            
            const resizeObserver = new ResizeObserver(updatePosition);
            resizeObserver.observe(document.body);
            window.addEventListener('scroll', updatePosition, true);

            return () => {
                resizeObserver.disconnect();
                window.removeEventListener('scroll', updatePosition, true);
            };

        }
    }, [isTourActive, currentStep, steps]);

    if (isWelcomeVisible) {
        return (
            <Modal isOpen={true} onClose={onFinish} title={`Welcome to AcademiBot, ${user.name}!`}>
                <p>We're glad to have you here. To help you get started, we can take a quick, AI-powered tour of the application tailored just for you.</p>
                <div className="form-actions" style={{ marginTop: '1rem' }}>
                    <button className="btn btn-secondary" onClick={onFinish}>Skip for Now</button>
                    <button className="btn btn-primary" onClick={handleStartTour} disabled={isLoading}>
                        {isLoading ? <LoadingSpinnerSm /> : 'Start Tour'}
                    </button>
                </div>
            </Modal>
        );
    }
    
    if (isTourActive && targetRect) {
        const tooltipStyle: React.CSSProperties = {};
        if (targetRect.bottom + 320 > window.innerHeight) { // Position on top if not enough space below
            tooltipStyle.top = `${targetRect.top - 16}px`;
            tooltipStyle.transform = 'translateY(-100%)';
        } else {
            tooltipStyle.top = `${targetRect.bottom + 16}px`;
        }
        if (targetRect.left + 320 > window.innerWidth) { // Align right
            tooltipStyle.left = `${targetRect.right - 320}px`;
        } else {
            tooltipStyle.left = `${targetRect.left}px`;
        }
        
        return (
            <div className="onboarding-overlay">
                <div className="onboarding-spotlight" style={{
                    top: `${targetRect.top - 4}px`,
                    left: `${targetRect.left - 4}px`,
                    width: `${targetRect.width + 8}px`,
                    height: `${targetRect.height + 8}px`,
                }}></div>
                <div className="onboarding-tooltip" style={tooltipStyle}>
                    <p>{steps[currentStep].content}</p>
                    <div className="onboarding-tooltip-footer">
                         <span className="onboarding-steps">{currentStep + 1} / {steps.length}</span>
                         <div className="onboarding-nav">
                            <button className="btn btn-secondary btn-sm" onClick={handleFinish}>End Tour</button>
                            {currentStep > 0 && <button className="btn btn-secondary btn-sm" onClick={handlePrev}>Prev</button>}
                            <button className="btn btn-primary btn-sm" onClick={handleNext}>
                                {currentStep === steps.length - 1 ? 'Finish' : 'Next'}
                            </button>
                         </div>
                    </div>
                </div>
            </div>
        )
    }

    return null;
}

// --- App Component ---
const App: React.FC = () => {
    const [view, setView] = usePersistedState<AppView>('timetable-view', 'dashboard');
    const [currentUser, setCurrentUser] = usePersistedState<User | null>('timetable-user', null);
    const [timetableEntries, setTimetableEntries] = usePersistedState<TimetableEntry[]>('timetable-entries', INITIAL_TIMETABLE_ENTRIES);
    const [timeSlots, setTimeSlots] = usePersistedState<string[]>('timetable-slots', TIME_SLOTS_DEFAULT);
    const [isSidebarOpen, setSidebarOpen] = useState(false);
    const [theme, setTheme] = usePersistedState<'light' | 'dark'>('timetable-theme', 'light');
    const [users, setUsers] = usePersistedState<User[]>('timetable-users', INITIAL_USERS);
    const [leaveRequests, setLeaveRequests] = usePersistedState<LeaveRequest[]>('timetable-leave-requests', INITIAL_LEAVE_REQUESTS);
    const [announcements, setAnnouncements] = usePersistedState<Announcement[]>('timetable-announcements', INITIAL_ANNOUNCEMENTS);
    const [resourceRequests, setResourceRequests] = usePersistedState<ResourceRequest[]>('timetable-resource-requests', []);
    const [auditLog, setAuditLog] = usePersistedState<AuditLogEntry[]>('timetable-audit-log', INITIAL_AUDIT_LOG);
    const [notifications, setNotifications] = useState<AppNotification[]>([]);
    const [securityAlerts, setSecurityAlerts] = usePersistedState<SecurityAlert[]>('timetable-security-alerts', INITIAL_SECURITY_ALERTS);
    const [deadlines, setDeadlines] = usePersistedState<Deadline[]>('timetable-deadlines', INITIAL_DEADLINES);
    const [isOnboardingActive, setIsOnboardingActive] = useState(false);
    
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
    }, [theme]);
    

    const addNotification = useCallback((message: string, type: AppNotification['type']) => {
        const id = uuidv4();
        setNotifications(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setNotifications(prev => prev.filter(n => n.id !== id));
        }, 5000);
    }, []);

    const dismissNotification = (id: string) => {
        setNotifications(prev => prev.filter(n => n.id !== id));
    };
    
    const addAuditLog = useCallback((entry: Omit<AuditLogEntry, 'id' | 'timestamp'>) => {
        const newEntry: AuditLogEntry = {
            id: uuidv4(),
            timestamp: new Date().getTime(),
            ...entry
        };
        setAuditLog(prev => [newEntry, ...prev]);
    }, [setAuditLog]);

    useEffect(() => {
        if (!currentUser && view !== 'auth') {
             setView('auth');
        }
    }, [currentUser, view]); 

    const canApprove = useCallback((item: LeaveRequest | User) => {
        if (currentUser?.role === 'admin') return true;
        if (currentUser?.role === 'hod') {
            if ('facultyId' in item) { // is LeaveRequest
                const facultyUser = users.find(u => u.id === item.facultyId);
                return facultyUser?.dept === currentUser.dept;
            }
            if ('role' in item) { // is User
                return item.dept === currentUser.dept;
            }
        }
        return false;
    }, [currentUser, users]);

    const handleLogin = (user: User, isAutoLogin = false) => {
        setCurrentUser(user);
        setView('dashboard');
        addAuditLog({ 
            userId: user.name, 
            action: isAutoLogin ? 'AUTO_LOGIN_SUCCESS' : 'LOGIN_SUCCESS', 
            ip: '192.168.1.1', 
            status: 'success' 
        });
        if (!user.hasCompletedOnboarding) {
            setIsOnboardingActive(true);
        }
    };

    const handleLogout = () => {
        if (currentUser) {
            addAuditLog({ userId: currentUser.name, action: 'LOGOUT', ip: '192.168.1.1', status: 'info' });
        }
        setCurrentUser(null);
        setView('auth');
    };

    const handleRegister = useCallback(async (newUser: User): Promise<boolean> => {
        if (users.some(u => u.id === newUser.id || u.name.toLowerCase() === newUser.name.toLowerCase())) {
            return false;
        }

        if (ai) {
            try {
                const prompt = `Assess this user registration for a college management app. Based on their role and department, provide a brief, one-sentence summary for administrator review. User details: Role: ${newUser.role}, Department: ${newUser.dept}.`;
                const response = await ai.models.generateContent({model: 'gemini-2.5-flash', contents: prompt});
                newUser.aiAssessment = response.text;
            } catch (e) {
                console.error("AI assessment failed:", e);
                newUser.aiAssessment = "AI assessment could not be generated.";
            }
        }

        const isAdminPresent = users.some(u => u.role === 'admin' && u.status === 'active');
        if (newUser.role === 'admin' && !isAdminPresent) {
            newUser.status = 'active';
            addNotification("Admin account created and approved. Please log in.", "success");
        } else {
            addNotification("Registration successful! Your account is pending approval.", "success");
        }

        setUsers(prev => [...prev, newUser]);
        addAuditLog({ userId: newUser.name, action: 'REGISTER_PENDING', ip: '192.168.1.1', status: 'info' });
        return true;
    }, [users, setUsers, addAuditLog, addNotification]);
    
    const completeOnboarding = () => {
        if (!currentUser) return;
        const updatedUser = { ...currentUser, hasCompletedOnboarding: true };
        setCurrentUser(updatedUser);
        setUsers(prevUsers => prevUsers.map(u => u.id === currentUser.id ? updatedUser : u));
        setIsOnboardingActive(false);
    };


    const renderView = () => {
        if (!currentUser) return null;
        switch (view) {
            case 'dashboard':
                return <DashboardView 
                            currentUser={currentUser!}
                            users={users}
                            timetableEntries={timetableEntries}
                            leaveRequests={leaveRequests}
                            announcements={announcements}
                            resourceRequests={resourceRequests}
                            deadlines={deadlines}
                            setView={setView}
                            timeSlots={timeSlots}
                        />
            case 'timetable':
                return <TimetableView 
                            timetableEntries={timetableEntries} 
                            timeSlots={timeSlots} 
                            setLeaveRequests={setLeaveRequests}
                        />
            case 'manage':
                 return <ManageTimetableView 
                            timetableEntries={timetableEntries} 
                            setTimetableEntries={setTimetableEntries} 
                            timeSlots={timeSlots} 
                            users={users} 
                        />
            case 'settings':
                return <SettingsView timeSlots={timeSlots} setTimeSlots={setTimeSlots} />
            case 'approvals':
                return <ApprovalsView 
                            leaveRequests={leaveRequests} 
                            setLeaveRequests={setLeaveRequests} 
                            users={users} 
                            setUsers={setUsers}
                            timetableEntries={timetableEntries} 
                            timeSlots={timeSlots}
                            canApprove={canApprove}
                        />
            case 'studentDirectory':
                return <StudentDirectoryView users={users} />
            case 'announcements':
                 return <AnnouncementsView
                    announcements={announcements}
                    setAnnouncements={setAnnouncements}
                />;
            case 'userManagement':
                return <UserManagementView 
                    users={users}
                    setUsers={setUsers}
                    addAuditLog={addAuditLog}
                    addNotification={addNotification}
                />;
            case 'security':
                return <SecurityCenterView 
                    auditLog={auditLog}
                    users={users}
                    securityAlerts={securityAlerts}
                    setSecurityAlerts={setSecurityAlerts}
                    setUsers={setUsers}
                />;
            default:
                return <DashboardView 
                            currentUser={currentUser!}
                            users={users}
                            timetableEntries={timetableEntries}
                            leaveRequests={leaveRequests}
                            announcements={announcements}
                            resourceRequests={resourceRequests}
                            deadlines={deadlines}
                            setView={setView}
                            timeSlots={timeSlots}
                        />
        }
    };
    
    if (!currentUser) {
        return (
            <AppContext.Provider value={{ currentUser, addNotification }}>
                <LoginView onLogin={handleLogin} onRegister={handleRegister} users={users} />
                <NotificationCenter notifications={notifications} onDismiss={dismissNotification} />
            </AppContext.Provider>
        );
    }
    

    const visibleViews = Object.entries(APP_VIEWS_CONFIG)
        .filter(([_, config]) => config.roles.length === 0 || config.roles.includes(currentUser.role));

    return (
        <AppContext.Provider value={{ currentUser, addNotification }}>
        <div className={`app-container ${isSidebarOpen ? 'sidebar-open' : ''}`}>
             <NotificationCenter notifications={notifications} onDismiss={dismissNotification} />
             <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)}></div>
            <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
                 <div className="sidebar-header">
                    <div className="logo">{Icons.logo}</div>
                    <h1>AcademiBot</h1>
                    <button className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar">{Icons.close}</button>
                </div>
                <nav>
                    <ul className="nav-list">
                        {visibleViews.map(([viewKey, viewConfig]) => {
                           if (viewKey === 'auth') return null;
                           const isApprovals = viewKey === 'approvals';
                           const notificationCount = isApprovals ? (leaveRequests.filter(r => r.status === 'pending' && canApprove(r)).length + users.filter(u => u.status === 'pending_approval' && canApprove(u)).length) : 0;
                           
                           return (
                                <li key={viewKey} className="nav-item">
                                    <button 
                                        data-view={viewKey}
                                        className={view === viewKey ? 'active' : ''}
                                        onClick={() => {
                                            setView(viewKey as AppView);
                                            setSidebarOpen(false);
                                        }}
                                    >
                                        {Icons[viewConfig.icon]}
                                        <span>{viewConfig.title}</span>
                                         {isApprovals && notificationCount > 0 && (
                                            <span className="notification-badge">{notificationCount}</span>
                                        )}
                                    </button>
                                </li>
                           )
                        })}
                    </ul>
                </nav>
            </aside>
            <main className="main-content">
                <Header 
                    currentView={APP_VIEWS_CONFIG[view]?.title || 'Dashboard'} 
                    onMenuToggle={() => setSidebarOpen(true)}
                    onLogout={handleLogout}
                    theme={theme}
                    setTheme={setTheme}
                />
                <div className="page-content">{renderView()}</div>
            </main>
            <Chatbot />
            {isOnboardingActive && <OnboardingGuide user={currentUser} onFinish={completeOnboarding} />}
        </div>
        </AppContext.Provider>
    );
};


const root = createRoot(document.getElementById('root')!);
root.render(<App />);