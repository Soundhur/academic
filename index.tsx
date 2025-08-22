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
    guardian: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 2.25c.392 0 .771.045 1.141.131l.314.074c1.13 1.26 2.003 2.74 2.536 4.387.533 1.647.809 3.42.809 5.242a9.75 9.75 0 01-1.222 4.793l-.15.275a2.25 2.25 0 01-3.95 0l-.15-.275a9.75 9.75 0 01-1.222-4.793c0-1.822.276-3.595.81-5.242.532-1.647 1.405-3.127 2.536-4.387l-.314-.074A5.92 5.92 0 0112 2.25zM12 2.25c-.392 0-.771.045-1.141.131l-.314.074c-1.13 1.26-2.003 2.74-2.536 4.387-.533 1.647-.809 3.42-.809 5.242a9.75 9.75 0 001.222 4.793l.15.275a2.25 2.25 0 003.95 0l.15-.275a9.75 9.75 0 001.222-4.793c0-1.822-.276-3.595-.81-5.242-.532-1.647-1.405-3.127-2.536-4.387l-.314-.074A5.92 5.92 0 0012 2.25zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zM12 15.75a.75.75 0 100-1.5.75.75 0 000 1.5z"></path></svg>,
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
    { id: 'cse-ii-mon-oops-myshree', department: 'CSE', year: 'II', day: 'Monday', timeIndex: 1, subject: 'OOPS', type: 'class' as const, faculty: 'Ms. MYSHREE B', room: 'A212' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Monday', timeIndex: 3, subject: 'FDS', type: 'class' as const, faculty: 'Mrs. ANITHA M', room: 'A212' },
    { id: 'cse-ii-mon-dst-soundhur', department: 'CSE', year: 'II', day: 'Monday', timeIndex: 4, subject: 'DST', type: 'class' as const, faculty: 'Mr. SOUNDHUR', room: 'A212' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Monday', timeIndex: 5, subject: 'MAT', type: 'class' as const, faculty: 'Ms. YUVASRI', room: 'A212' },
    
    // Tuesday
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Tuesday', timeIndex: 0, subject: 'DCCN', type: 'class' as const, faculty: 'Ms. RANJANI J', room: 'A212' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Tuesday', timeIndex: 1, subject: 'DCCN', type: 'class' as const, faculty: 'Ms. RANJANI J', room: 'A212' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Tuesday', timeIndex: 3, subject: 'DST', type: 'class' as const, faculty: 'Mr. SOUNDHUR', room: 'A212' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Tuesday', timeIndex: 4, subject: 'OOPS', type: 'class' as const, faculty: 'Ms. MYSHREE B', room: 'A212' },
    { id: uuidv4(), department: 'CSE', year: 'II', day: 'Tuesday', timeIndex: 5, subject: 'FDS', type: 'class' as const, faculty: 'Mrs. ANITHA M', room: 'A212' },

    // --- ECE II Year Schedule ---
    { id: uuidv4(), department: 'ECE', year: 'II', day: 'Monday', timeIndex: 0, subject: 'Digital Circuits', type: 'class' as const, faculty: 'Ms. RANJANI J', room: 'B101' },
];

const INITIAL_LEAVE_REQUESTS: LeaveRequest[] = [
    { id: 'leave-1', facultyId: 'faculty-soundhur', facultyName: 'Mr. SOUNDHUR', timetableEntryId: 'cse-ii-mon-dst-soundhur', day: 'Monday', timeIndex: 4, status: 'pending', timestamp: new Date().getTime() - 3600000, reason: 'Personal emergency' },
    { id: 'leave-2', facultyId: 'faculty-myshree-b', facultyName: 'Ms. MYSHREE B', timetableEntryId: 'cse-ii-mon-oops-myshree', day: 'Monday', timeIndex: 1, status: 'pending', timestamp: new Date().getTime() - 7200000, reason: 'Feeling unwell' }
];

const INITIAL_RESOURCE_REQUESTS: ResourceRequest[] = [
    { id: 'res-1', userId: 'faculty-ranjani-j', requestText: 'Requesting access to the new FPGA development boards for the Digital Circuits lab.', status: 'pending', timestamp: new Date().getTime() - 86400000 * 2 }
];

const INITIAL_SECURITY_ALERTS: SecurityAlert[] = [
    { id: 'alert-1', type: 'Anomaly', title: 'Unusual Login Pattern', description: 'User student-alice logged in from an unrecognized IP address (198.51.100.24) at 2:15 AM.', timestamp: Date.now() - 3600000 * 3, severity: 'medium', relatedUserId: 'student-alice', isResolved: false, responsePlan: { containment: 'Monitor user activity for further anomalies.', investigation: 'Verify login with the user.', recovery: 'If malicious, force logout and password reset.', recommendedAction: 'MONITOR' } },
    { id: 'alert-2', type: 'Threat', title: 'Potential Brute-force Attack', description: 'Detected 25 failed login attempts for user admin in the last 15 minutes.', timestamp: Date.now() - 3600000 * 24, severity: 'high', relatedUserId: 'admin', isResolved: true, responsePlan: { containment: 'Temporarily lock the account.', investigation: 'Analyze source IPs and login attempt patterns.', recovery: 'Unlock account after verification with the administrator.', recommendedAction: 'LOCK_USER' } },
];

const INITIAL_DEADLINES: Deadline[] = [
    { id: 'deadline-1', title: 'Internal Assessment Marks Submission', dueDate: Date.now() + 86400000 * 5, audience: ['faculty', 'hod', 'class advisor'] },
    { id: 'deadline-2', title: 'Course Fee Payment - Final Reminder', dueDate: Date.now() + 86400000 * 10, audience: ['student'] },
];

// --- APP CONTEXT ---
const AppContext = createContext<any>(null);
const useAppContext = () => useContext(AppContext);

// --- MAIN APP COMPONENT ---
const App = () => {
    // STATE MANAGEMENT
    const [theme, setTheme] = usePersistedState('theme', 'light');
    const [appView, setAppView] = useState<AppView>('auth');
    const [currentUser, setCurrentUser] = usePersistedState<User | null>('currentUser', null);
    const [users, setUsers] = usePersistedState<User[]>('users', INITIAL_USERS);
    const [timetableEntries, setTimetableEntries] = usePersistedState<TimetableEntry[]>('timetableEntries', INITIAL_TIMETABLE_ENTRIES);
    const [timeSlots, setTimeSlots] = usePersistedState<string[]>('timeSlots', TIME_SLOTS_DEFAULT);
    const [leaveRequests, setLeaveRequests] = usePersistedState<LeaveRequest[]>('leaveRequests', INITIAL_LEAVE_REQUESTS);
    const [announcements, setAnnouncements] = usePersistedState<Announcement[]>('announcements', INITIAL_ANNOUNCEMENTS);
    const [resourceRequests, setResourceRequests] = usePersistedState<ResourceRequest[]>('resourceRequests', INITIAL_RESOURCE_REQUESTS);
    const [notifications, setNotifications] = useState<AppNotification[]>([]);
    const [securityAlerts, setSecurityAlerts] = usePersistedState<SecurityAlert[]>('securityAlerts', INITIAL_SECURITY_ALERTS);
    const [deadlines, setDeadlines] = usePersistedState<Deadline[]>('deadlines', INITIAL_DEADLINES);
    const [isSidebarOpen, setSidebarOpen] = useState(false);
    const [isChatbotOpen, setChatbotOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    // --- EFFECTS ---
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
    }, [theme]);

    useEffect(() => {
        // Simulate initial loading
        setTimeout(() => {
            if (currentUser) {
                setAppView('dashboard');
            } else {
                setAppView('auth');
            }
            setIsLoading(false);
        }, 500);
    }, []);

    // --- HELPER FUNCTIONS ---
    const addNotification = (message: string, type: AppNotification['type']) => {
        const id = uuidv4();
        setNotifications(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setNotifications(current => current.filter(n => n.id !== id));
        }, 5000);
    };

    const handleLogin = (user: User) => {
        if (user.isLocked) {
             addNotification('Account is locked. Please contact an administrator.', 'error');
             return false;
        }
        setCurrentUser(user);
        setAppView('dashboard');
        addNotification(`Welcome back, ${user.name}!`, 'success');
        return true;
    };

    const handleLogout = () => {
        setCurrentUser(null);
        setAppView('auth');
        addNotification('You have been logged out.', 'info');
    };
    
    // --- CONTEXT VALUE ---
    const contextValue = {
        theme, setTheme,
        appView, setAppView,
        currentUser, setCurrentUser,
        users, setUsers,
        timetableEntries, setTimetableEntries,
        timeSlots, setTimeSlots,
        leaveRequests, setLeaveRequests,
        announcements, setAnnouncements,
        resourceRequests, setResourceRequests,
        securityAlerts, setSecurityAlerts,
        deadlines, setDeadlines,
        isSidebarOpen, setSidebarOpen,
        isChatbotOpen, setChatbotOpen,
        addNotification,
        handleLogout,
        handleLogin,
    };

    if (isLoading) {
        return <div className="loading-fullscreen"><div className="spinner"></div></div>;
    }

    if (!currentUser || appView === 'auth') {
        return (
            <AppContext.Provider value={contextValue}>
                <AuthView />
            </AppContext.Provider>
        );
    }
    
    return (
        <AppContext.Provider value={contextValue}>
            <div className={`app-container ${isSidebarOpen ? 'sidebar-open' : ''}`}>
                <Sidebar />
                <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)}></div>
                <main className="main-content">
                    <Header />
                    <div className="page-content">
                        {appView === 'dashboard' && <DashboardView />}
                        {appView === 'timetable' && <TimetableView />}
                        {appView === 'manage' && <ManageTimetableView />}
                        {appView === 'settings' && <SettingsView />}
                        {appView === 'approvals' && <ApprovalsView />}
                        {appView === 'announcements' && <AnnouncementsView />}
                        {appView === 'studentDirectory' && <StudentDirectoryView />}
                        {appView === 'userManagement' && <UserManagementView />}
                        {appView === 'security' && <SecurityCenterView />}
                    </div>
                </main>
                <Chatbot />
                <OnboardingTour />
            </div>
        </AppContext.Provider>
    );
};

// --- Child Components (stubs for brevity, implementation will follow) ---
const Sidebar = () => {
    // ... Implementation
    return <div className="sidebar"></div>
};
const Header = () => {
    // ... Implementation
    return <div className="header"></div>
};
const DashboardView = () => {
    // ... Implementation
    return <h2>Dashboard</h2>
};
const TimetableView = () => {
    // ... Implementation
    return <h2>Timetable</h2>
};
const ManageTimetableView = () => {
    // ... Implementation
    return <h2>Manage Timetable</h2>
};
const SettingsView = () => {
    // ... Implementation
    return <h2>Settings</h2>
};
const ApprovalsView = () => {
    const { leaveRequests, timetableEntries, users, addNotification } = useAppContext();
    const handleGetAiSuggestion = useCallback(async (req: LeaveRequest) => {
        if (!isAiEnabled) {
            addNotification('AI features are disabled.', 'warning');
            return;
        }
        const timetableEntry = timetableEntries.find((e: TimetableEntry) => e.id === req.timetableEntryId);
        if (!timetableEntry) {
            addNotification(`AI suggestion failed: Could not find timetable entry for request ${req.timetableEntryId}`, 'error');
            return;
        }
        // ... rest of the logic
    }, [timetableEntries, users, addNotification]);

    return <h2>Approvals</h2>
};
const AnnouncementsView = () => {
    // ... Implementation
    return <h2>Announcements</h2>
};
const StudentDirectoryView = () => {
    // ... Implementation
    return <h2>Student Directory</h2>
};
const UserManagementView = () => {
    // ... Implementation
    return <h2>User Management</h2>
};
const SecurityCenterView = () => {
    // ... Implementation
    return <h2>Security Center</h2>
};
const AuthView = () => {
    // ... Implementation
    return <h2>Login/Register</h2>
};
const Chatbot = () => {
    // ... Implementation
    return null;
};
const OnboardingTour = () => {
    // ... Implementation
    return null;
};


// --- RENDER ---
const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
} else {
    console.error("Root element not found");
}
