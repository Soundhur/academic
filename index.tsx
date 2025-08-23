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
    status?: 'normal' | 'leave_pending' | 'substitution' | 'cancelled';
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
    publishTimestamp?: number; // For scheduling
    targetRole: 'all' | 'student' | 'faculty';
    targetDept: 'all' | 'CSE' | 'ECE' | 'EEE' | 'MCA' | 'AI&DS' | 'CYBERSECURITY' | 'MECHANICAL' | 'TAMIL' | 'ENGLISH' | 'MATHS' | 'LIB' | 'NSS' | 'NET';
    engagement?: { views: number; reactions: number };
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
type AppView = 'dashboard' | 'timetable' | 'manage' | 'settings' | 'auth' | 'approvals' | 'announcements' | 'studentDirectory' | 'security' | 'userManagement' | 'resources';
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

interface QuizQuestion {
    question: string;
    options: string[];
    correctAnswer: string;
}
interface AIInsights {
    summary: string;
    keyConcepts: string[];
    quiz: QuizQuestion[];
    relatedResourceIds: string[];
}
interface Resource {
    id: string;
    name: string;
    type: 'book' | 'notes' | 'project' | 'other' | 'lab';
    department: string;
    subject: string;
    uploaderId: string;
    uploaderName: string;
    timestamp: number;
    fileName?: string;
    fileUrl?: string; // a fake URL for now
    aiSafetyStatus: 'pending' | 'safe' | 'unsafe' | 'irrelevant';
    aiSafetyReason?: string;
    aiInsightsStatus: 'pending' | 'generating' | 'complete' | 'failed';
    aiInsights?: AIInsights | null;
    version: number;
}
interface ResourceUpdateLog {
    id: string;
    resourceId: string;
    timestamp: number;
    updatedByUserId: string;
    updatedByUserName: string;
    version: number;
    previousFileName: string;
    newFileName: string;
    aiChangeSummary?: string;
}


interface WebResource {
    id: string;
    url: string;
    title: string;
    summary: string;
    department: string;
    subject: string;
    addedById: string;
    addedByName: string;
    timestamp: number;
    aiStatus: 'approved' | 'rejected' | 'pending';
    aiReason?: string;
}

interface QnAPost {
    id: string;
    resourceId: string;
    authorId: string;
    authorName: string;
    text: string;
    timestamp: number;
    isAiReply?: boolean;
    parentId?: string; // For threading replies
}

interface ResourceLog {
    id: string;
    resourceId: string;
    resourceName: string;
    userId: string;
    userName: string;
    action: 'upload' | 'download' | 'update';
    timestamp: number;
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
    target: string; // CSS selector
    contentKey: string; // A key to generate AI prompt
    title: string;
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
    dashboard: { title: "For You", icon: "dashboard", roles: ['student', 'faculty', 'hod', 'admin', 'class advisor'] },
    timetable: { title: "Timetable", icon: "timetable", roles: ['student', 'faculty', 'hod', 'admin', 'class advisor'] },
    resources: { title: "Resources", icon: "bookOpen", roles: ['student', 'faculty', 'hod', 'admin', 'class advisor'] },
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
    send: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.949a.75.75 0 00.95.544l4.25-1.215a.75.75 0 01.544.95l-1.414 4.949a.75.75 0 00.95.826l12.25-3.5a.75.75 0 000-1.392l-12.25-3.5a.75.75 0 00-.124-.012z"></path></svg>,
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
    speaker: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" /></svg>,
    speakerMute: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-3l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" /></svg>,
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
    unlock: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>,
    guardian: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 2.25c.392 0 .771.045 1.141.131l.314.074c1.13 1.26 2.003 2.74 2.536 4.387.533 1.647.809 3.42.809 5.242a9.75 9.75 0 01-1.222 4.793l-.15.275a2.25 2.25 0 01-3.95 0l-.15-.275a9.75 9.75 0 01-1.222-4.793c0-1.822.276-3.595.81-5.242.532-1.647 1.405-3.127 2.536-4.387l-.314-.074A5.92 5.92 0 0112 2.25zM12 2.25c-.392 0-.771.045-1.141.131l-.314.074c-1.13 1.26-2.003 2.74-2.536 4.387-.533 1.647-.809 3.42-.809 5.242a9.75 9.75 0 001.222 4.793l.15.275a2.25 2.25 0 003.95 0l.15-.275a9.75 9.75 0 001.222-4.793c0-1.822-.276-3.595-.81-5.242-.532-1.647-1.405-3.127-2.536-4.387l-.314-.074A5.92 5.92 0 0012 2.25zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zM12 15.75a.75.75 0 100-1.5.75.75 0 000 1.5z"></path></svg>,
    calendarDays: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0h18M-4.5 12h22.5" /></svg>,
    bookOpen: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-16.512a8.967 8.967 0 016 2.292c1.052.332 2.062.512 3 .512v14.25a8.987 8.987 0 00-3-1.488c-2.305-.9-4.408-2.292-6-2.292m0 0a8.967 8.967 0 00-6 2.292m6-2.292v16.5" /></svg>,
    upload: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>,
    download: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>,
    file: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>,
    search: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>,
    viewGrid: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 8.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 018.25 20.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6A2.25 2.25 0 0115.75 3.75h2.25A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25A2.25 2.25 0 0113.5 8.25V6zM13.5 15.75A2.25 2.25 0 0115.75 13.5h2.25a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></svg>,
    viewList: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg>,
    externalLink: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-4.5 0V6.375c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0110.5 10.5z" /></svg>,
    beaker: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M10 20.25h4M7.5 7.5h9v7.5a3.75 3.75 0 01-3.75 3.75h-1.5A3.75 3.75 0 017.5 15V7.5zM7.5 7.5V6A2.25 2.25 0 019.75 3.75h4.5A2.25 2.25 0 0116.5 6v1.5" /></svg>,
    chatBubble: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.068.158 2.148.279 3.238.364.466.037.893.281 1.153.671L12 21l3.652-3.978c.26-.282.687-.534 1.153-.67 1.09-.086 2.17-.206 3.238-.365 1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.344 48.344 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" /></svg>,
    history: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
    google: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="24px" height="24px"><path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"></path><path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"></path><path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.222,0-9.619-3.317-11.28-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"></path><path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.574l6.19,5.238C41.38,36.43,44,30.686,44,24C44,22.659,43.862,21.35,43.611,20.083z"></path></svg>,
    microsoft: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20px" height="20px"><path fill="#f35325" d="M1 1h10v10H1z"></path><path fill="#81bc06" d="M13 1h10v10H13z"></path><path fill="#05a6f0" d="M1 13h10v10H1z"></path><path fill="#ffba08" d="M13 13h10v10H13z"></path></svg>,

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
    { id: 'admin', name: 'Administrator', password: 'password', role: 'admin', dept: 'SYSTEM', status: 'active' },
    { id: 'hod-jane-smith', name: 'Jane Smith', password: 'password', role: 'hod', dept: 'CSE', status: 'active', specialization: ['AI/ML', 'Data Structures'], officeHours: [{day: 'Monday', time: '2:00 PM - 3:00 PM'}] },
    { id: 'advisor-anitha-m', name: 'Mrs. ANITHA M', password: 'password', role: 'class advisor', dept: 'CSE', year: 'II', status: 'active', specialization: ['Data Science', 'Web Technologies'] },
    { id: 'advisor-deepak-mr', name: 'Mr. Deepak', password: 'password', role: 'class advisor', dept: 'CSE', year: 'IV', status: 'active', specialization: ['Advanced Algorithms', 'Compiler Design'] },
    { id: 'faculty-yuvasri', name: 'Ms. YUVASRI', password: 'password', role: 'faculty', dept: 'MATHS', status: 'active', specialization: ['Discrete Mathematics'] },
    { id: 'faculty-ranjani-j', name: 'Ms. RANJANI J', password: 'password', role: 'faculty', dept: 'ECE', status: 'active', specialization: ['Digital Principles', 'Computer Organization'] },
    { id: 'faculty-soundhur', name: 'Mr. SOUNDHUR', password: 'password', role: 'faculty', dept: 'CSE', status: 'active', specialization: ['Data Structures'] },
    { id: 'faculty-myshree-b', name: 'Ms. MYSHREE B', password: 'password', role: 'faculty', dept: 'CSE', status: 'active', specialization: ['Object Oriented Programming'] },
    { id: 'faculty-chithambaram', name: 'Mr. CHITHAMBARAM', password: 'password', role: 'faculty', dept: 'NSS', status: 'active', specialization: ['NSS Coordinator'] },
    { id: 'student-alice', name: 'Alice', password: 'password', role: 'student', dept: 'CSE', year: 'II', status: 'active', grades: [{ subject: 'Data Structures', score: 85 }, {subject: 'AI/ML', score: 91}], attendance: { present: 70, total: 75 }, hasCompletedOnboarding: false },
    { id: 'student-bob', name: 'Bob', password: 'password', role: 'student', dept: 'ECE', year: 'II', status: 'active', grades: [{ subject: 'Digital Circuits', score: 92 }], attendance: { present: 68, total: 75 }, hasCompletedOnboarding: true },
    { id: 'pending-user', name: 'Pending User', password: 'password', role: 'faculty', dept: 'EEE', status: 'pending_approval' },
];

const INITIAL_ANNOUNCEMENTS: Announcement[] = [
    { id: 'ann-1', title: "Mid-term Examinations Schedule", content: "The mid-term examinations for all departments will commence from the 15th of next month. Detailed schedule will be shared shortly.", author: "Admin", timestamp: new Date().getTime() - 86400000, targetRole: 'all', targetDept: 'all', engagement: { views: 128, reactions: 15 } },
    { id: 'ann-2', title: "Project Submission Deadline (CSE)", content: "Final year CSE students are reminded that the project submission deadline is this Friday.", author: "HOD (CSE)", timestamp: new Date().getTime() - 172800000, targetRole: 'student', targetDept: 'CSE', engagement: { views: 42, reactions: 5 } }
];

const INITIAL_TIMETABLE_ENTRIES: TimetableEntry[] = [
    // --- Common Breaks/Lunch for all ---
    ...DAYS.flatMap(day => [
        { id: uuidv4(), department: 'all' as const, year: 'all' as const, day: day as any, timeIndex: 2, subject: 'Break', type: 'break' as const, status: 'normal' as const },
        { id: uuidv4(), department: 'all' as const, year: 'all' as const, day: day as any, timeIndex: 6, subject: 'Lunch', type: 'break' as const, status: 'normal' as const }
    ]),
    
    // --- CSE II Year Schedule ---
    // Monday
    { id: 'cse-ii-mon-oops-myshree', department: 'CSE' as const, year: 'II' as const, day: 'Monday' as const, timeIndex: 1, subject: 'OOPS', type: 'class' as const, faculty: 'Ms. MYSHREE B', room: 'A212', status: 'leave_pending' as const },
    { id: uuidv4(), department: 'CSE' as const, year: 'II' as const, day: 'Monday' as const, timeIndex: 3, subject: 'FDS', type: 'class' as const, faculty: 'Mrs. ANITHA M', room: 'A212', status: 'normal' as const },
    { id: 'cse-ii-mon-dst-soundhur', department: 'CSE' as const, year: 'II' as const, day: 'Monday' as const, timeIndex: 4, subject: 'DST', type: 'class' as const, faculty: 'Mr. SOUNDHUR', room: 'A212', status: 'leave_pending' as const },
    { id: uuidv4(), department: 'CSE' as const, year: 'II' as const, day: 'Monday' as const, timeIndex: 5, subject: 'MAT', type: 'class' as const, faculty: 'Ms. YUVASRI', room: 'A212', status: 'normal' as const },
    
    // Tuesday
    { id: uuidv4(), department: 'CSE' as const, year: 'II' as const, day: 'Tuesday' as const, timeIndex: 0, subject: 'DCCN', type: 'class' as const, faculty: 'Ms. RANJANI J', room: 'A212', status: 'normal' as const },
    { id: uuidv4(), department: 'CSE' as const, year: 'II' as const, day: 'Tuesday' as const, timeIndex: 1, subject: 'DCCN', type: 'class' as const, faculty: 'Ms. RANJANI J', room: 'A212', status: 'normal' as const },
    { id: uuidv4(), department: 'CSE' as const, year: 'II' as const, day: 'Tuesday' as const, timeIndex: 3, subject: 'DST', type: 'class' as const, faculty: 'Mr. SOUNDHUR', room: 'A212', status: 'normal' as const },
    { id: uuidv4(), department: 'CSE' as const, year: 'II' as const, day: 'Tuesday' as const, timeIndex: 4, subject: 'OOPS', type: 'class' as const, faculty: 'Ms. MYSHREE B', room: 'A212', status: 'normal' as const },
    { id: uuidv4(), department: 'CSE' as const, year: 'II' as const, day: 'Tuesday' as const, timeIndex: 5, subject: 'FDS', type: 'class' as const, faculty: 'Mrs. ANITHA M', room: 'A212', status: 'normal' as const },

    // --- ECE II Year Schedule ---
    { id: uuidv4(), department: 'ECE' as const, year: 'II' as const, day: 'Monday' as const, timeIndex: 0, subject: 'Digital Circuits', type: 'class' as const, faculty: 'Ms. RANJANI J', room: 'B101', status: 'normal' as const },
];

const INITIAL_LEAVE_REQUESTS: LeaveRequest[] = [
    { id: 'leave-1', facultyId: 'faculty-soundhur', facultyName: 'Mr. SOUNDHUR', timetableEntryId: 'cse-ii-mon-dst-soundhur', day: 'Monday', timeIndex: 4, status: 'pending', timestamp: new Date().getTime() - 3600000, reason: 'Personal emergency' },
    { id: 'leave-2', facultyId: 'faculty-myshree-b', facultyName: 'Ms. MYSHREE B', timetableEntryId: 'cse-ii-mon-oops-myshree', day: 'Monday', timeIndex: 1, status: 'pending', timestamp: new Date().getTime() - 7200000, reason: 'Feeling unwell' }
];

const INITIAL_RESOURCE_REQUESTS: ResourceRequest[] = [
    { id: 'res-1', userId: 'faculty-ranjani-j', requestText: 'Requesting access to the new FPGA development boards for the Digital Circuits lab.', status: 'pending', timestamp: new Date().getTime() - 86400000 * 2 }
];

const INITIAL_RESOURCES: Resource[] = [
    { id: 'res-001', name: 'Data Structures & Algorithms', type: 'book', department: 'CSE', subject: 'DST', uploaderId: 'admin', uploaderName: 'Admin', timestamp: Date.now() - 86400000 * 5, fileName: 'DSA_Complete.pdf', aiSafetyStatus: 'safe', aiSafetyReason: 'Verified educational content.', aiInsights: null, aiInsightsStatus: 'pending', version: 1 },
    { id: 'res-002', name: 'OOPs Concepts Lecture Notes', type: 'notes', department: 'CSE', subject: 'OOPS', uploaderId: 'faculty-myshree-b', uploaderName: 'Ms. MYSHREE B', timestamp: Date.now() - 86400000 * 2, fileName: 'OOPS_Notes_Unit1.docx', aiSafetyStatus: 'safe', aiSafetyReason: 'Verified educational content.', aiInsights: null, aiInsightsStatus: 'pending', version: 1 },
    { id: 'res-003', name: 'Digital Principles Textbook', type: 'book', department: 'ECE', subject: 'Digital Principles', uploaderId: 'faculty-ranjani-j', uploaderName: 'Ms. RANJANI J', timestamp: Date.now() - 86400000 * 10, fileName: 'Digital_Principles.pdf', aiSafetyStatus: 'safe', aiSafetyReason: 'Verified educational content.', aiInsights: null, aiInsightsStatus: 'pending', version: 1 },
    { id: 'res-004', name: 'Final Year Project - AI Chatbot', type: 'project', department: 'CSE', subject: 'AI/ML', uploaderId: 'admin', uploaderName: 'Admin', timestamp: Date.now() - 86400000 * 3, fileName: 'project_report_chatbot.pdf', aiSafetyStatus: 'safe', aiSafetyReason: 'Verified educational content.', aiInsights: null, aiInsightsStatus: 'pending', version: 1 },
    { id: 'res-005', name: 'Lab Manual for Digital Signal Processing Lab', type: 'lab', department: 'ECE', subject: 'DSP Lab', uploaderId: 'admin', uploaderName: 'Admin', timestamp: Date.now() - 86400000 * 7, fileName: 'ECE_DSP_Lab_Manual.pdf', aiSafetyStatus: 'safe', aiSafetyReason: 'Verified educational content.', aiInsights: null, aiInsightsStatus: 'pending', version: 1 },
];
const INITIAL_RESOURCE_UPDATE_LOGS: ResourceUpdateLog[] = [];

const INITIAL_WEB_RESOURCES: WebResource[] = [
    { id: 'web-res-1', url: 'https://www.geeksforgeeks.org/data-structures/', title: 'GeeksforGeeks: Data Structures', summary: 'A comprehensive resource for learning about various data structures with examples and tutorials.', department: 'CSE', subject: 'DST', addedById: 'admin', addedByName: 'Admin', timestamp: Date.now() - 86400000 * 4, aiStatus: 'approved', aiReason: 'Relevant and high-quality educational content.' },
    { id: 'web-res-2', url: 'https://www.tutorialspoint.com/object_oriented_programming/index.htm', title: 'TutorialsPoint: OOPs Concepts', summary: 'An introduction to Object-Oriented Programming concepts, covering topics like inheritance, polymorphism, and encapsulation.', department: 'CSE', subject: 'OOPS', addedById: 'admin', addedByName: 'Admin', timestamp: Date.now() - 86400000 * 3, aiStatus: 'approved', aiReason: 'Relevant and high-quality educational content.' },
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
    const [resources, setResources] = usePersistedState<Resource[]>('resources', INITIAL_RESOURCES);
    const [resourceUpdateLogs, setResourceUpdateLogs] = usePersistedState<ResourceUpdateLog[]>('resourceUpdateLogs', INITIAL_RESOURCE_UPDATE_LOGS);
    const [webResources, setWebResources] = usePersistedState<WebResource[]>('webResources', INITIAL_WEB_RESOURCES);
    const [resourceLogs, setResourceLogs] = usePersistedState<ResourceLog[]>('resourceLogs', []);
    const [userNotes, setUserNotes] = usePersistedState<Record<string, string>>('userNotes', {});
    const [qnaPosts, setQnaPosts] = usePersistedState<QnAPost[]>('qnaPosts', []);
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

    // Background AI Insights Generator
    useEffect(() => {
        const processPendingInsights = async () => {
            if (!isAiEnabled || !ai) return;

            const pendingResource = resources.find(r => r.aiInsightsStatus === 'pending');
            if (!pendingResource) return;

            // Mark as generating
            setResources(prev => prev.map(r => r.id === pendingResource.id ? { ...r, aiInsightsStatus: 'generating' } : r));

            const otherResources = resources.filter((r: Resource) => r.id !== pendingResource.id);
            const prompt = `You are an advanced academic AI assistant. Your task is to analyze a learning resource based on its metadata and generate insightful, helpful content for a student.

                Resource Metadata:
                - Name: "${pendingResource.name}"
                - Type: "${pendingResource.type}"
                - Subject: "${pendingResource.subject}"
                - Department: "${pendingResource.department}"

                List of all other available resources in the library (for finding related content):
                ${JSON.stringify(otherResources.map(r => ({ id: r.id, name: r.name, subject: r.subject })))}

                Based on the metadata of the target resource, generate the following content.
                Response must be a single JSON object.

                JSON Schema:
                {
                "summary": "A concise, one-paragraph summary of what this resource is likely about.",
                "keyConcepts": ["A list of 3-5 key concepts or topics covered.", "List item 2", "List item 3"],
                "quiz": [
                    {
                    "question": "A relevant multiple-choice question based on the key concepts.",
                    "options": ["Option A", "Option B", "Correct Answer", "Option D"],
                    "correctAnswer": "Correct Answer"
                    },
                    {
                    "question": "A second multiple-choice question.",
                    "options": ["Option 1", "Correct Answer", "Option 3", "Option 4"],
                    "correctAnswer": "Correct Answer"
                    }
                ],
                "relatedResourceIds": ["A list of up to 3 relevant resource IDs from the provided list of other resources.", "res-id-2"]
                }`;
            
            try {
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: prompt,
                    config: { responseMimeType: 'application/json' }
                });
                const insights = JSON.parse(response.text);
                setResources(prev => prev.map(r => r.id === pendingResource.id ? { ...r, aiInsights: insights, aiInsightsStatus: 'complete' } : r));
            } catch (error) {
                console.error("Background AI Insights Error:", error);
                setResources(prev => prev.map(r => r.id === pendingResource.id ? { ...r, aiInsightsStatus: 'failed' } : r));
            }
        };

        // Use a timeout to stagger the processing and avoid running on initial load spam
        const timeoutId = setTimeout(processPendingInsights, 2000);
        return () => clearTimeout(timeoutId);

    }, [resources, setResources]);


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
        resources, setResources,
        resourceUpdateLogs, setResourceUpdateLogs,
        webResources, setWebResources,
        resourceLogs, setResourceLogs,
        userNotes, setUserNotes,
        qnaPosts, setQnaPosts,
        securityAlerts, setSecurityAlerts,
        deadlines, setDeadlines,
        isSidebarOpen, setSidebarOpen,
        isChatbotOpen, setChatbotOpen,
        addNotification,
        handleLogout,
        handleLogin,
        notifications, // Pass notifications to context for the portal
        setNotifications, // Pass setter for the portal
    };

    if (isLoading) {
        return <div className="loading-fullscreen"><div className="spinner"></div></div>;
    }

    if (!currentUser || appView === 'auth') {
        return (
            <AppContext.Provider value={contextValue}>
                <AuthView />
                 <NotificationPortal />
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
                        {appView === 'resources' && <ResourcesView />}
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
                <NotificationPortal />
            </div>
        </AppContext.Provider>
    );
};

// --- Child Components ---

const Sidebar = () => {
    const { appView, setAppView, currentUser, leaveRequests, users, resourceRequests, isSidebarOpen, setSidebarOpen } = useAppContext();

    const pendingApprovalsCount = useMemo(() => {
        if (!currentUser || !['hod', 'admin'].includes(currentUser.role)) return 0;
        const pendingLeaves = leaveRequests.filter((r: LeaveRequest) => r.status === 'pending').length;
        const pendingUsers = users.filter((u: User) => u.status === 'pending_approval').length;
        const pendingResources = resourceRequests.filter((r: ResourceRequest) => r.status === 'pending').length;
        return pendingLeaves + pendingUsers + pendingResources;
    }, [leaveRequests, users, resourceRequests, currentUser]);

    return (
        <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
            <div className="sidebar-header">
                <span className="logo">{Icons.logo}</span>
                <h1>AcademiaAI</h1>
                <button className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar">
                    {Icons.close}
                </button>
            </div>
            <nav>
                <ul className="nav-list">
                    {Object.entries(APP_VIEWS_CONFIG).map(([key, view]) => {
                        if (view.roles.length === 0 || !currentUser || !view.roles.includes(currentUser.role)) {
                            return null;
                        }
                        const isApprovals = key === 'approvals';
                        return (
                            <li key={key} className="nav-item">
                                <button
                                    className={appView === key ? 'active' : ''}
                                    onClick={() => {
                                        setAppView(key as AppView);
                                        setSidebarOpen(false);
                                    }}
                                    data-tour-id={key}
                                >
                                    {Icons[view.icon]}
                                    <span>{view.title}</span>
                                    {isApprovals && pendingApprovalsCount > 0 && (
                                        <span className="notification-badge">{pendingApprovalsCount}</span>
                                    )}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </nav>
        </aside>
    );
};

const Header = () => {
    const { appView, currentUser, handleLogout, theme, setTheme, setSidebarOpen } = useAppContext();
    const currentViewConfig = APP_VIEWS_CONFIG[appView];

    const toggleTheme = () => {
        setTheme(theme === 'light' ? 'dark' : 'light');
    };

    return (
        <header className="header">
            <div className="header-left">
                 <button className="menu-toggle" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar">
                    {Icons.menu}
                </button>
                <h2 className="header-title">{currentViewConfig?.title || "Dashboard"}</h2>
            </div>
            <div className="header-right">
                <div className="user-info">
                    <strong>{currentUser?.name}</strong><br/>
                    <small>{currentUser?.role}</small>
                </div>
                <button onClick={toggleTheme} className="theme-toggle" aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}>
                    {theme === 'light' ? Icons.moon : Icons.sun}
                </button>
                <button onClick={handleLogout} className="btn btn-secondary">Logout</button>
            </div>
        </header>
    );
};

const DashboardView = () => {
    const { currentUser, announcements, deadlines, leaveRequests, users, resourceRequests, timetableEntries, timeSlots } = useAppContext();

    const feedItems = useMemo(() => {
        let items: any[] = [];
        const now = Date.now();
        const today = DAYS[new Date().getDay() -1] || 'Monday';

        // Upcoming Classes
        timetableEntries
            .filter((e: TimetableEntry) => {
                const isMyClass = (currentUser.role === 'student' && e.department === currentUser.dept && e.year === currentUser.year) ||
                                (currentUser.role !== 'student' && e.faculty === currentUser.name);
                return e.day === today && (isMyClass || e.department === 'all');
            })
            .forEach((e: TimetableEntry) => items.push({ type: 'class', data: e, timestamp: now - e.timeIndex }));

        // Announcements
        announcements
            .filter((a: Announcement) => (a.targetRole === 'all' || a.targetRole === currentUser.role) && (a.targetDept === 'all' || a.targetDept === currentUser.dept))
            .forEach((a: Announcement) => items.push({ type: 'announcement', data: a, timestamp: a.timestamp }));

        // Deadlines
        deadlines
            .filter((d: Deadline) => d.audience.includes('all') || d.audience.includes(currentUser.role))
            .forEach((d: Deadline) => items.push({ type: 'deadline', data: d, timestamp: d.dueDate }));

        // Approvals (for hod/admin)
        if (['hod', 'admin'].includes(currentUser.role)) {
            leaveRequests.filter((r: LeaveRequest) => r.status === 'pending').forEach((r: LeaveRequest) => items.push({ type: 'approval', subType: 'Leave', data: r, timestamp: r.timestamp }));
            users.filter((u: User) => u.status === 'pending_approval').forEach((u: User) => items.push({ type: 'approval', subType: 'New User', data: u, timestamp: now }));
            resourceRequests.filter((r: ResourceRequest) => r.status === 'pending').forEach((r: ResourceRequest) => items.push({ type: 'approval', subType: 'Resource', data: r, timestamp: r.timestamp }));
        }

        return items.sort((a, b) => b.timestamp - a.timestamp);

    }, [currentUser, announcements, deadlines, leaveRequests, users, resourceRequests, timetableEntries]);

    const renderFeedItem = (item: any) => {
        switch (item.type) {
            case 'class':
                const entry = item.data;
                const isBreakOrCommon = entry.type === 'break' || entry.type === 'common';
                const title = isBreakOrCommon ? `Upcoming Schedule: ${entry.subject}` : `Upcoming Class: ${entry.subject}`;
                
                return (
                    <div className="feed-item-card class">
                        <div className="feed-item-icon">{Icons.timetable}</div>
                        <div className="feed-item-content">
                            <p className="feed-item-title">{title}</p>
                            <p className="feed-item-meta">
                                {timeSlots[entry.timeIndex]} {entry.faculty && `with ${entry.faculty}`}
                            </p>
                        </div>
                    </div>
                );
            case 'announcement':
                const ann = item.data;
                return (
                    <div className="feed-item-card announcement">
                        <div className="feed-item-icon">{Icons.announcement}</div>
                        <div className="feed-item-content">
                            <p className="feed-item-title">{ann.title}</p>
                            <p className="feed-item-meta">
                                New announcement from {ann.author} &bull; {getRelativeTime(ann.timestamp)}
                            </p>
                        </div>
                    </div>
                );
            case 'deadline':
                const d = item.data;
                return (
                    <div className="feed-item-card deadline">
                        <div className="feed-item-icon">{Icons.calendarDays}</div>
                        <div className="feed-item-content">
                            <p className="feed-item-title">Upcoming Deadline: {d.title}</p>
                            <p className="feed-item-meta">
                                Due on {new Date(d.dueDate).toLocaleDateString()}
                            </p>
                        </div>
                    </div>
                );
            case 'approval':
                 return (
                    <div className="feed-item-card approval">
                        <div className="feed-item-icon">{Icons.approvals}</div>
                        <div className="feed-item-content">
                            <p className="feed-item-title">New Approval Request</p>
                            <p className="feed-item-meta">
                                A new "{item.subType}" request is awaiting your review.
                            </p>
                        </div>
                    </div>
                );
            default:
                return null;
        }
    };
    
    return (
        <div className="dashboard-container">
            <h2 className="dashboard-greeting">Welcome back, {currentUser.name}!</h2>
            <div className="dashboard-card for-you-feed">
                <h3>Here's what's new for you:</h3>
                <div className="feed-list">
                    {feedItems.length > 0 ? (
                        feedItems.map((item, index) => (
                           <React.Fragment key={index}>
                               {renderFeedItem(item)}
                           </React.Fragment>
                        ))
                    ) : (
                        <p>No new updates for you right now.</p>
                    )}
                </div>
            </div>
        </div>
    );
};

const TimetableView = () => {
    const { currentUser, timetableEntries, timeSlots, leaveRequests } = useAppContext();
    const [selectedDept, setSelectedDept] = useState(currentUser?.dept || DEPARTMENTS[0]);
    const [selectedYear, setSelectedYear] = useState(currentUser?.year || YEARS[0]);
    const [popover, setPopover] = useState<{ x: number, y: number, entry: TimetableEntry } | null>(null);

    const filteredEntries = useMemo(() => {
        let entries = timetableEntries.map((entry: TimetableEntry) => {
            const pendingRequest = leaveRequests.find((req: LeaveRequest) => req.timetableEntryId === entry.id && req.status === 'pending');
            return {
                ...entry,
                status: pendingRequest ? 'leave_pending' : entry.status || 'normal',
            };
        });

        return entries.filter((entry: TimetableEntry) =>
            (entry.department === 'all') ||
            (entry.department === selectedDept && entry.year === selectedYear)
        );
    }, [timetableEntries, leaveRequests, selectedDept, selectedYear]);

    const handleCellClick = (e: React.MouseEvent, entry: TimetableEntry) => {
        if (entry.type !== 'class') return;
        const rect = e.currentTarget.getBoundingClientRect();
        setPopover({ x: rect.left, y: rect.bottom, entry });
    };

    return (
        <div className="timetable-container">
            <div className="timetable-header">
                <h3>Class Timetable</h3>
                <div className="timetable-controls">
                    <select className="form-control" value={selectedDept} onChange={e => setSelectedDept(e.target.value)}>
                        {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <select className="form-control" value={selectedYear} onChange={e => setSelectedYear(e.target.value)}>
                        {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                </div>
            </div>
            <div className="timetable-wrapper">
                <div className="timetable-grid">
                    {/* Headers */}
                    <div className="grid-header">Time</div>
                    {DAYS.map(day => <div key={day} className="grid-header">{day}</div>)}

                    {/* Time Slots and Cells */}
                    {timeSlots.map((slot, timeIndex) => (
                        <React.Fragment key={timeIndex}>
                            <div className="time-slot">{slot}</div>
                            {DAYS.map(day => {
                                const entry = filteredEntries.find((e: TimetableEntry) => e.day === day && e.timeIndex === timeIndex);
                                if (!entry) return <div key={day} className="grid-cell"></div>;

                                const isUserClass = currentUser.role === 'faculty' && entry.faculty === currentUser.name;
                                const cellClass = `grid-cell ${entry.type} ${isUserClass ? 'is-user-class' : ''} ${entry.status || 'normal'}`;

                                return (
                                    <div key={entry.id} className={cellClass} onClick={(e) => handleCellClick(e, entry)}>
                                        <span className="subject">{entry.subject}</span>
                                        {entry.faculty && <span className="faculty">{entry.faculty}</span>}
                                        {entry.room && <span className="faculty">{entry.room}</span>}
                                    </div>
                                );
                            })}
                        </React.Fragment>
                    ))}
                </div>
            </div>
            {popover && <TimetablePopover popover={popover} onClose={() => setPopover(null)} />}
        </div>
    );
};

const TimetablePopover = ({ popover, onClose }: { popover: { x: number, y: number, entry: TimetableEntry }, onClose: () => void }) => {
    const { setAppView } = useAppContext();
    const popoverRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
                onClose();
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [onClose]);

    const { entry, x, y } = popover;
    const style = {
        top: `${y + 8}px`,
        left: `${x}px`,
    };

    return (
        <div className="timetable-popover" style={style} ref={popoverRef}>
            <div className="popover-header">
                <h4>{entry.subject}</h4>
                <button onClick={onClose} className="close-btn">{Icons.close}</button>
            </div>
            <div className="popover-content">
                <p><strong>Faculty:</strong> {entry.faculty || 'N/A'}</p>
                <p><strong>Room:</strong> {entry.room || 'N/A'}</p>
                <p><strong>Department:</strong> {entry.department}, Year {entry.year}</p>
            </div>
            <div className="popover-actions">
                <button className="btn btn-secondary btn-sm" onClick={() => { setAppView('resources'); onClose(); }}>
                    {Icons.bookOpen} Study Material
                </button>
            </div>
        </div>
    );
};

const ManageTimetableView = () => {
    const { timetableEntries, setTimetableEntries, timeSlots, addNotification } = useAppContext();
    const [formData, setFormData] = useState<ManageFormData>({
        department: DEPARTMENTS[0],
        year: YEARS[0],
        day: DAYS[0],
        timeIndex: 0,
        subject: '',
        type: 'class',
        faculty: '',
        room: '',
    });
    const [editingId, setEditingId] = useState<string | null>(null);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: name === 'timeIndex' ? parseInt(value) : value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.subject) {
            addNotification('Subject cannot be empty.', 'error');
            return;
        }

        if (editingId) {
            // Update
            setTimetableEntries((prev: TimetableEntry[]) => prev.map(entry =>
                entry.id === editingId ? { ...entry, ...formData, id: editingId, status: 'normal' } : entry
            ));
            addNotification('Entry updated successfully.', 'success');
        } else {
            // Create
            const newEntry: TimetableEntry = { ...formData, id: uuidv4(), status: 'normal' };
            setTimetableEntries((prev: TimetableEntry[]) => [...prev, newEntry]);
            addNotification('Entry added successfully.', 'success');
        }
        resetForm();
    };

    const handleEdit = (entry: TimetableEntry) => {
        setEditingId(entry.id);
        setFormData({
            department: entry.department,
            year: entry.year,
            day: entry.day,
            timeIndex: entry.timeIndex,
            subject: entry.subject,
            type: entry.type,
            faculty: entry.faculty || '',
            room: entry.room || '',
        });
    };
    
    const handleDelete = (id: string) => {
        if (window.confirm('Are you sure you want to delete this entry?')) {
            setTimetableEntries((prev: TimetableEntry[]) => prev.filter(entry => entry.id !== id));
            addNotification('Entry deleted.', 'info');
        }
    };

    const resetForm = () => {
        setEditingId(null);
        setFormData({
            department: DEPARTMENTS[0],
            year: YEARS[0],
            day: DAYS[0],
            timeIndex: 0,
            subject: '',
            type: 'class',
            faculty: '',
            room: '',
        });
    };

    return (
        <div className="manage-timetable-container">
            <form className="entry-form" onSubmit={handleSubmit}>
                <h3>{editingId ? 'Edit Timetable Entry' : 'Add New Entry'}</h3>
                <div className="form-grid">
                    {/* Form Controls */}
                    <div className="control-group">
                        <label>Department</label>
                        <select name="department" value={formData.department} onChange={handleInputChange} className="form-control">
                            {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                    </div>
                     <div className="control-group">
                        <label>Year</label>
                        <select name="year" value={formData.year} onChange={handleInputChange} className="form-control">
                            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
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
                            {timeSlots.map((ts: string, i: number) => <option key={i} value={i}>{ts}</option>)}
                        </select>
                    </div>
                    <div className="control-group">
                        <label>Subject</label>
                        <input type="text" name="subject" value={formData.subject} onChange={handleInputChange} className="form-control" />
                    </div>
                    <div className="control-group">
                        <label>Faculty</label>
                        <input type="text" name="faculty" value={formData.faculty} onChange={handleInputChange} className="form-control" />
                    </div>
                    <div className="control-group">
                        <label>Room</label>
                        <input type="text" name="room" value={formData.room} onChange={handleInputChange} className="form-control" />
                    </div>
                     <div className="control-group">
                        <label>Type</label>
                        <select name="type" value={formData.type} onChange={handleInputChange} className="form-control">
                            <option value="class">Class</option>
                            <option value="break">Break</option>
                            <option value="common">Common</option>
                        </select>
                    </div>
                </div>
                <div className="form-actions">
                    {editingId && <button type="button" className="btn btn-secondary" onClick={resetForm}>Cancel Edit</button>}
                    <button type="submit" className="btn btn-primary">{editingId ? 'Update Entry' : 'Add Entry'}</button>
                </div>
            </form>

            <div className="entry-list-container">
                 <h3>Existing Entries</h3>
                 <div className="table-wrapper">
                     <table className="entry-list-table">
                        <thead>
                            <tr><th>Day</th><th>Time</th><th>Dept/Year</th><th>Subject</th><th>Faculty</th><th>Actions</th></tr>
                        </thead>
                        <tbody>
                            {timetableEntries.filter((e: TimetableEntry) => e.type === 'class').sort((a,b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.timeIndex - b.timeIndex).map((entry: TimetableEntry) => (
                                <tr key={entry.id}>
                                    <td data-label="Day">{entry.day}</td>
                                    <td data-label="Time">{timeSlots[entry.timeIndex]}</td>
                                    <td data-label="Dept/Year">{entry.department} / {entry.year}</td>
                                    <td data-label="Subject">{entry.subject}</td>
                                    <td data-label="Faculty">{entry.faculty}</td>
                                    <td data-label="Actions" className="entry-actions">
                                        <button onClick={() => handleEdit(entry)}>{Icons.editPencil}</button>
                                        <button onClick={() => handleDelete(entry.id)} className="delete-btn">{Icons.delete}</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                     </table>
                </div>
            </div>
        </div>
    );
};

const SettingsView = () => {
    return (
        <div className="settings-container">
            <h2>Settings</h2>
             <div className="settings-card">
                <h3>System Configuration</h3>
                <p>Global system settings will be available here in a future update.</p>
            </div>
        </div>
    );
};

const ApprovalsView = () => {
    const { leaveRequests, setLeaveRequests, users, setUsers, resourceRequests, setResourceRequests, addNotification, timetableEntries, timeSlots, currentUser } = useAppContext();
    const [activeTab, setActiveTab] = useState('leave');
    const [loadingAI, setLoadingAI] = useState<string | null>(null);
    const [selectedItems, setSelectedItems] = useState<Record<string, Set<string>>>({ leave: new Set(), users: new Set(), resources: new Set() });

    const handleSelection = (id: string) => {
        setSelectedItems(prev => {
            const newSelection = new Set(prev[activeTab]);
            if (newSelection.has(id)) {
                newSelection.delete(id);
            } else {
                newSelection.add(id);
            }
            return { ...prev, [activeTab]: newSelection };
        });
    };
    
    const handleBatchAction = (status: 'approved' | 'rejected' | 'active') => {
        const selectedIds = selectedItems[activeTab];
        if (selectedIds.size === 0) return;

        switch (activeTab) {
            case 'leave':
                setLeaveRequests((prev: LeaveRequest[]) => prev.map(req => selectedIds.has(req.id) ? { ...req, status: status as 'approved' | 'rejected' } : req));
                break;
            case 'users':
                setUsers((prev: User[]) => prev.map(user => selectedIds.has(user.id) ? { ...user, status: status as 'active' | 'rejected' } : user));
                break;
            case 'resources':
                setResourceRequests((prev: ResourceRequest[]) => prev.map(req => selectedIds.has(req.id) ? { ...req, status: status as 'approved' | 'rejected' } : req));
                break;
        }
        addNotification(`${selectedIds.size} item(s) have been ${status}.`, 'success');
        setSelectedItems(prev => ({...prev, [activeTab]: new Set()}));
    };

    const handleGetAiSuggestion = useCallback(async (req: LeaveRequest) => {
        if (!isAiEnabled || !ai) {
            addNotification('AI features are disabled.', 'warning');
            return;
        }
        setLoadingAI(req.id);
        const timetableEntry = timetableEntries.find((e: TimetableEntry) => e.id === req.timetableEntryId);
        if (!timetableEntry) {
            addNotification(`AI suggestion failed: Could not find timetable entry.`, 'error');
            setLoadingAI(null);
            return;
        }

        const availableFaculty = users.filter((u: User) => u.role === 'faculty' && u.id !== req.facultyId);
        const originalFaculty = users.find((u: User) => u.id === req.facultyId);
        
        const prompt = `Find a substitute for a leave request.
        - Requesting Faculty: ${req.facultyName} (Specializations: ${originalFaculty?.specialization?.join(', ') || 'N/A'})
        - Subject: "${timetableEntry.subject}"
        - Time: ${req.day} at ${timeSlots[req.timeIndex]}
        - Reason: "${req.reason || 'Not specified'}"
        - Available Faculty Pool: ${availableFaculty.map(f => `${f.name} (Specializations: ${f.specialization?.join(', ') || 'N/A'})`).join('; ')}.
        
        Analyze the available faculty and provide the single best substitution suggestion. Justify your choice based on specialization and relevance to the subject.`;
        
        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    systemInstruction: "You are a highly efficient academic coordinator AI. Your task is to find the most suitable substitute faculty for leave requests, prioritizing subject matter expertise.",
                }
            });
            setLeaveRequests((prev: LeaveRequest[]) => prev.map(r => r.id === req.id ? { ...r, aiSuggestion: response.text } : r));
        } catch (error) {
            console.error("AI Suggestion Error:", error);
            addNotification('Failed to get AI suggestion.', 'error');
        } finally {
            setLoadingAI(null);
        }
    }, [timetableEntries, users, addNotification, setLeaveRequests, timeSlots]);


    const pendingLeave = leaveRequests.filter((r: LeaveRequest) => r.status === 'pending');
    const pendingUsers = users.filter((u: User) => u.status === 'pending_approval');
    const pendingResources = resourceRequests.filter((r: ResourceRequest) => r.status === 'pending');
    const currentSelection = selectedItems[activeTab];

    return (
        <div className="approvals-container">
            <div className="tabs">
                <button className={`tab-button ${activeTab === 'leave' ? 'active' : ''}`} onClick={() => setActiveTab('leave')}>
                    Leave Requests ({pendingLeave.length})
                </button>
                <button className={`tab-button ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>
                    New Users ({pendingUsers.length})
                </button>
                <button className={`tab-button ${activeTab === 'resources' ? 'active' : ''}`} onClick={() => setActiveTab('resources')}>
                    Resources ({pendingResources.length})
                </button>
            </div>

            {currentSelection.size > 0 && (
                <div className="batch-actions-bar">
                    <span>{currentSelection.size} item(s) selected</span>
                    <div className="batch-actions-buttons">
                        <button className="btn btn-secondary btn-sm" onClick={() => handleBatchAction(activeTab === 'users' ? 'rejected' : 'rejected')}>Reject</button>
                        <button className="btn btn-success btn-sm" onClick={() => handleBatchAction(activeTab === 'users' ? 'active' : 'approved')}>Approve</button>
                    </div>
                </div>
            )}
            
            <div className="approval-list">
                {activeTab === 'leave' && pendingLeave.map((req: LeaveRequest) => (
                    <div key={req.id} className={`approval-card ${currentSelection.has(req.id) ? 'selected' : ''}`} onClick={() => handleSelection(req.id)}>
                        <div className="approval-card-main">
                             <h4>Leave Request</h4>
                             <p><strong>Faculty:</strong> {req.facultyName}</p>
                             <p><strong>Date:</strong> {req.day}, {timeSlots[req.timeIndex]}</p>
                             <p><strong>Reason:</strong> {req.reason || 'Not specified'}</p>
                             <small>Requested {getRelativeTime(req.timestamp)}</small>
                        </div>
                        <div className="approval-card-ai">
                            <h5>{Icons.lightbulb} AI Assistant</h5>
                            {req.aiSuggestion ? (
                                <p className="ai-suggestion">{req.aiSuggestion}</p>
                            ) : (
                                <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); handleGetAiSuggestion(req); }} disabled={loadingAI === req.id}>
                                    {loadingAI === req.id ? <span className="spinner-sm"/> : "Get Suggestion"}
                                </button>
                            )}
                        </div>
                    </div>
                ))}
                
                 {activeTab === 'users' && pendingUsers.map((user: User) => (
                    <div key={user.id} className={`approval-card ${currentSelection.has(user.id) ? 'selected' : ''}`} onClick={() => handleSelection(user.id)}>
                        <div className="approval-card-main">
                            <h4>New User Registration</h4>
                            <p><strong>Name:</strong> {user.name}</p>
                            <p><strong>Username:</strong> {user.id}</p>
                            <p><strong>Role:</strong> {user.role}</p>
                            <p><strong>Department:</strong> {user.dept}</p>
                            {user.year && <p><strong>Year:</strong> {user.year}</p>}
                        </div>
                        <div className="approval-card-ai">
                             <h5>{Icons.lightbulb} AI Assessment</h5>
                             <p className="ai-assessment">{user.aiAssessment || "No anomalies detected."}</p>
                        </div>
                    </div>
                ))}

                 {activeTab === 'resources' && pendingResources.map((req: ResourceRequest) => (
                    <div key={req.id} className={`approval-card ${currentSelection.has(req.id) ? 'selected' : ''}`} onClick={() => handleSelection(req.id)}>
                       <div className="approval-card-main">
                           <h4>Resource Request</h4>
                           <p><strong>From:</strong> {users.find((u:User) => u.id === req.userId)?.name || req.userId}</p>
                           <p><strong>Request:</strong> {req.requestText}</p>
                           <small>Requested {getRelativeTime(req.timestamp)}</small>
                       </div>
                        <div className="approval-card-ai">
                             <h5>{Icons.lightbulb} AI Recommendation</h5>
                             <p className="ai-recommendation">{req.aiRecommendation || "AI is analyzing this request..."}</p>
                        </div>
                    </div>
                 ))}
                 
                 {activeTab === 'leave' && pendingLeave.length === 0 && <p>No pending leave requests.</p>}
                 {activeTab === 'users' && pendingUsers.length === 0 && <p>No new user registrations to approve.</p>}
                 {activeTab === 'resources' && pendingResources.length === 0 && <p>No pending resource requests.</p>}
            </div>
        </div>
    );
};
const AnnouncementsView = () => {
    const { announcements } = useAppContext();
    const [showCreateForm, setShowCreateForm] = useState(false);
    const { currentUser } = useAppContext();

    const canCreate = currentUser.role === 'admin' || currentUser.role === 'hod';

    return (
        <div className="announcements-view-container">
            <div className="announcements-header">
                <h2>Announcements</h2>
                {canCreate && (
                    <button className="btn btn-primary" onClick={() => setShowCreateForm(s => !s)}>
                        {showCreateForm ? 'Cancel' : 'Create New'}
                    </button>
                )}
            </div>
            
            {showCreateForm && <CreateAnnouncementForm setShowCreateForm={setShowCreateForm} />}
            
            <div className="announcement-list">
                {announcements.sort((a,b) => b.timestamp - a.timestamp).map(ann => (
                    <div key={ann.id} className="announcement-card">
                        <div className="announcement-item-header">
                            <h3>{ann.title}</h3>
                            <div className="announcement-item-meta">
                                <span>by {ann.author}</span>
                                <span>{getRelativeTime(ann.timestamp)}</span>
                            </div>
                        </div>
                        <div className="announcement-item-targets">
                            <span className="target-pill">{ann.targetRole}</span>
                            <span className="target-pill">{ann.targetDept}</span>
                        </div>
                        <p className="announcement-item-content">{ann.content}</p>
                        <div className="announcement-item-engagement">
                            <span>{ann.engagement?.views || 0} views</span>
                            <span>{ann.engagement?.reactions || 0} reactions</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

const CreateAnnouncementForm = ({ setShowCreateForm }: { setShowCreateForm: (s: boolean) => void }) => {
    const { setAnnouncements, currentUser, addNotification } = useAppContext();
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [targetRole, setTargetRole] = useState<Announcement['targetRole']>('all');
    const [targetDept, setTargetDept] = useState<Announcement['targetDept']>('all');
    const [isRefining, setIsRefining] = useState(false);
    const [publishDate, setPublishDate] = useState('');
    const [publishTime, setPublishTime] = useState('');

    const handleRefine = async () => {
        if (!isAiEnabled || !ai) {
             addNotification('AI features are disabled.', 'warning');
             return;
        }
        if (!content) {
            addNotification('Please enter some content to refine.', 'warning');
            return;
        }
        setIsRefining(true);
        const prompt = `Refine the following announcement for clarity, tone, and professionalism, suitable for a college environment. Keep the core message intact.\n\nAnnouncement: "${content}"`;
        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    systemInstruction: "You are an expert editor for academic and administrative communications. Your goal is to make announcements clear, professional, and concise."
                }
            });
            setContent(response.text);
        } catch (error) {
            console.error("AI Refinement Error:", error);
            addNotification('Failed to refine content with AI.', 'error');
        }
        setIsRefining(false);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!title || !content) {
            addNotification('Title and content are required.', 'error');
            return;
        }

        let publishTimestamp = Date.now();
        if (publishDate && publishTime) {
            publishTimestamp = new Date(`${publishDate}T${publishTime}`).getTime();
            if (isNaN(publishTimestamp) || publishTimestamp < Date.now()) {
                addNotification('Please select a valid future date and time for scheduling.', 'error');
                return;
            }
        }
        
        const newAnnouncement: Announcement = {
            id: uuidv4(),
            title,
            content,
            author: currentUser.name,
            timestamp: Date.now(),
            publishTimestamp: publishTimestamp > Date.now() ? publishTimestamp : undefined,
            targetRole,
            targetDept,
            engagement: { views: 0, reactions: 0 }
        };
        setAnnouncements((prev: Announcement[]) => [newAnnouncement, ...prev]);
        addNotification(newAnnouncement.publishTimestamp ? 'Announcement scheduled successfully.' : 'Announcement posted successfully.', 'success');
        setShowCreateForm(false);
    };
    
    return (
        <form className="create-announcement-form" onSubmit={handleSubmit}>
            <h3>New Announcement</h3>
            <div className="control-group">
                <label>Title</label>
                <input type="text" className="form-control" value={title} onChange={e => setTitle(e.target.value)} />
            </div>
            <div className="control-group refine-button-container">
                <label>Content</label>
                <textarea className="form-control" value={content} onChange={e => setContent(e.target.value)} />
                <button type="button" className="btn btn-secondary btn-sm refine-btn" onClick={handleRefine} disabled={isRefining}>
                    {isRefining ? <span className="spinner-sm"/> : <>{Icons.lightbulb} Refine with AI</>}
                </button>
            </div>
             <div className="form-grid">
                <div className="control-group">
                    <label>Target Role</label>
                    <select className="form-control" value={targetRole} onChange={e => setTargetRole(e.target.value as Announcement['targetRole'])}>
                        <option value="all">All Users</option>
                        <option value="student">Students</option>
                        <option value="faculty">Faculty</option>
                    </select>
                </div>
                 <div className="control-group">
                    <label>Target Department</label>
                    <select className="form-control" value={targetDept} onChange={e => setTargetDept(e.target.value as Announcement['targetDept'])}>
                        <option value="all">All Departments</option>
                        {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                </div>
            </div>
            <div className="scheduling-options">
                <h4>Scheduling (Optional)</h4>
                <div className="form-grid">
                    <div className="control-group">
                        <label>Publish Date</label>
                        <input type="date" className="form-control" value={publishDate} onChange={e => setPublishDate(e.target.value)} />
                    </div>
                    <div className="control-group">
                        <label>Publish Time</label>
                        <input type="time" className="form-control" value={publishTime} onChange={e => setPublishTime(e.target.value)} />
                    </div>
                </div>
            </div>
            <div className="form-actions">
                <button type="submit" className="btn btn-primary">
                    {publishDate && publishTime ? 'Schedule Announcement' : 'Post Announcement'}
                </button>
            </div>
        </form>
    )
};

const useDebouncedEffect = (effect: () => void, deps: React.DependencyList, delay: number) => {
    useEffect(() => {
        const handler = setTimeout(() => effect(), delay);
        return () => clearTimeout(handler);
    }, [...deps, delay]);
};

const AIRecommendations = ({ onSelectResource }: { onSelectResource: (res: Resource) => void }) => {
    const { currentUser, resources, addNotification } = useAppContext();
    const [recommendations, setRecommendations] = useState<Resource[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchRecommendations = async () => {
            if (!isAiEnabled || !ai) {
                setIsLoading(false);
                return;
            }

            const resourceContext = resources.map((r: Resource) => ({
                id: r.id,
                name: r.name,
                subject: r.subject,
                department: r.department,
                type: r.type,
            }));

            const prompt = `You are a personalized academic advisor AI. Your goal is to recommend relevant learning materials to a user based on their profile.
            User Profile:
            - Role: ${currentUser.role}
            - Department: ${currentUser.dept}
            - Year: ${currentUser.year || 'N/A'}
    
            Available Resources (JSON format):
            ${JSON.stringify(resourceContext)}
    
            Analyze the user's profile and the list of available resources. Select up to 5 resources that would be most beneficial for this user. Prioritize resources matching their department and year (if student). Return ONLY a JSON array of the recommended resource IDs.
            Example response: ["res-001", "res-002"]`;

            try {
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: prompt,
                    config: { responseMimeType: 'application/json' }
                });
                const recommendedIds = JSON.parse(response.text);
                const recommendedResources = resources.filter((r: Resource) => recommendedIds.includes(r.id));
                setRecommendations(recommendedResources);
            } catch (error) {
                console.error("AI Recommendation Error:", error);
                // Don't show a notification for this as it's a background enhancement
            } finally {
                setIsLoading(false);
            }
        };

        fetchRecommendations();
    }, [currentUser, resources]);

    if (isLoading) {
        return (
            <div className="recommendations-container">
                <h3>{Icons.lightbulb} AI Recommendations For You</h3>
                <div className="recommendations-carousel">
                    {[...Array(3)].map((_, i) => <div key={i} className="skeleton-card"></div>)}
                </div>
            </div>
        );
    }
    
    if (recommendations.length === 0) {
        return null; // Don't show the section if there are no recommendations
    }

    return (
        <div className="recommendations-container">
            <h3>{Icons.lightbulb} AI Recommendations For You</h3>
            <div className="recommendations-carousel">
                {recommendations.map(res => (
                    <div key={res.id} className="recommendation-card" onClick={() => onSelectResource(res)}>
                         <div className="recommendation-card-icon">{resourceTypeIcons[res.type]}</div>
                         <div>
                            <h4 className="recommendation-card-title">{res.name}</h4>
                            <p className="recommendation-card-meta">{res.department} | {res.subject}</p>
                         </div>
                    </div>
                ))}
            </div>
        </div>
    );
};


const ResourcesView = () => {
    const { resources, webResources, resourceLogs, currentUser, addNotification } = useAppContext();
    const [isUploadModalOpen, setUploadModalOpen] = useState(false);
    const [isAddLinkModalOpen, setAddLinkModalOpen] = useState(false);
    const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
    const [updatingResource, setUpdatingResource] = useState<Resource | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [filters, setFilters] = useState({ department: 'all', type: 'all' });
    const [sortBy, setSortBy] = useState<'date-desc' | 'date-asc' | 'name-asc' | 'name-desc'>('date-desc');
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [isSearchLoading, setIsSearchLoading] = useState(false);
    const [searchResults, setSearchResults] = useState<string[] | null>(null);
    const [activeTab, setActiveTab] = useState<'library' | 'web'>('library');

    const downloadCounts = useMemo(() => {
        const counts = new Map<string, number>();
        resourceLogs.forEach((log: ResourceLog) => {
            if (log.action === 'download') {
                counts.set(log.resourceId, (counts.get(log.resourceId) || 0) + 1);
            }
        });
        return counts;
    }, [resourceLogs]);

    const handleSemanticSearch = useCallback(async (query: string) => {
        if (!isAiEnabled || !ai) {
            addNotification('AI search is disabled.', 'warning');
            return;
        }
        setIsSearchLoading(true);
        
        const isSearchingLibrary = activeTab === 'library';
        const contextSource = isSearchingLibrary ? resources : webResources;

        const resourceContext = contextSource.map((r: Resource | WebResource) => ({
            id: r.id,
            name: isSearchingLibrary ? (r as Resource).name : (r as WebResource).title,
            subject: r.subject,
            type: isSearchingLibrary ? (r as Resource).type : 'weblink',
            department: r.department,
        }));

        const prompt = `You are an intelligent search API for a university's digital library. Your task is to find the most relevant resources based on a user's natural language query.
        User Query: "${query}"
        Available Resources (JSON format): ${JSON.stringify(resourceContext)}

        Analyze the user's query and the available resources. Return a JSON array of resource IDs, ordered from most relevant to least relevant. Only include IDs that are a good match for the query. If no resources match, return an empty array.
        Example response: ["res-001", "res-002"]`;

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: { responseMimeType: 'application/json' }
            });
            const resultIds = JSON.parse(response.text);
            setSearchResults(resultIds);
        } catch (error) {
            console.error("AI Semantic Search Error:", error);
            addNotification('AI search failed.', 'error');
            setSearchResults([]);
        } finally {
            setIsSearchLoading(false);
        }
    }, [resources, webResources, addNotification, activeTab]);

    useDebouncedEffect(() => {
        if (searchTerm.trim().length > 2) {
            handleSemanticSearch(searchTerm);
        } else {
            setSearchResults(null);
        }
    }, [searchTerm], 500);

    const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFilters(prev => ({ ...prev, [name]: value }));
    };

    const filteredItems = useMemo(() => {
        let items: (Resource | WebResource)[] = activeTab === 'library' ? [...resources] : [...webResources];

        // 1. Filter by semantic search results if available
        if (searchResults !== null) {
            const resultsSet = new Set(searchResults);
            items = items.filter(res => resultsSet.has(res.id));
        }

        // 2. Apply standard filters
        items = items.filter((res: Resource | WebResource) => {
            const departmentMatch = filters.department === 'all' || res.department === filters.department;
            if (activeTab === 'library') {
                const typeMatch = filters.type === 'all' || (res as Resource).type === filters.type;
                return departmentMatch && typeMatch;
            }
            return departmentMatch;
        });

        // 3. Apply sorting
        items.sort((a, b) => {
            const nameA = activeTab === 'library' ? (a as Resource).name : (a as WebResource).title;
            const nameB = activeTab === 'library' ? (b as Resource).name : (b as WebResource).title;
            switch (sortBy) {
                case 'name-asc': return nameA.localeCompare(nameB);
                case 'name-desc': return nameB.localeCompare(nameA);
                case 'date-asc': return a.timestamp - b.timestamp;
                case 'date-desc':
                default:
                    return b.timestamp - a.timestamp;
            }
        });

        return items;
    }, [resources, webResources, searchResults, filters, sortBy, activeTab]);

    return (
        <div className="resources-container-view">
            {activeTab === 'library' && <AIRecommendations onSelectResource={setSelectedResource} />}
            <div className="resources-header">
                <h2>Digital Library</h2>
                <div className="resources-controls">
                    <div className="search-bar">
                        {Icons.search}
                        <input
                            type="search"
                            name="searchTerm"
                            placeholder={activeTab === 'library' ? "Ask for resources, e.g., 'notes on algorithms'" : "Search for web links, e.g., 'interactive tutorials for circuits'"}
                            className="form-control"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>
                <div className="resource-tabs">
                    <button className={activeTab === 'library' ? 'active' : ''} onClick={() => setActiveTab('library')}>
                        {Icons.clipboardList} Library ({resources.length})
                    </button>
                    <button className={activeTab === 'web' ? 'active' : ''} onClick={() => setActiveTab('web')}>
                        {Icons.externalLink} Web Links ({webResources.length})
                    </button>
                </div>
                <div className="resources-view-controls">
                    <div className="filters">
                         <select name="department" className="form-control" value={filters.department} onChange={handleFilterChange}>
                            <option value="all">All Departments</option>
                            {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                        {activeTab === 'library' && (
                            <select name="type" className="form-control" value={filters.type} onChange={handleFilterChange}>
                                <option value="all">All Types</option>
                                <option value="book">Book</option>
                                <option value="notes">Notes</option>
                                <option value="project">Project</option>
                                <option value="lab">Lab/Practical</option>
                                <option value="other">Other</option>
                            </select>
                        )}
                        <select name="sortBy" className="form-control" value={sortBy} onChange={e => setSortBy(e.target.value as any)}>
                            <option value="date-desc">Sort by Newest</option>
                            <option value="date-asc">Sort by Oldest</option>
                            <option value="name-asc">Sort by Name (A-Z)</option>
                            <option value="name-desc">Sort by Name (Z-A)</option>
                        </select>
                    </div>
                    <div className="view-mode-toggle">
                        <button className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')}>{Icons.viewGrid}</button>
                        <button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')}>{Icons.viewList}</button>
                    </div>
                     {activeTab === 'library' && (
                         <button className="btn btn-primary" onClick={() => setUploadModalOpen(true)}>
                            {Icons.upload} Upload File
                        </button>
                     )}
                     {activeTab === 'web' && currentUser.role === 'admin' && (
                         <button className="btn btn-primary" onClick={() => setAddLinkModalOpen(true)}>
                            {Icons.add} Add Link
                        </button>
                     )}
                </div>
            </div>
            
            {isSearchLoading ? (
                viewMode === 'grid' ? <ResourceGridSkeleton /> : <ResourceListSkeleton />
            ) : filteredItems.length > 0 ? (
                activeTab === 'library' ? (
                     viewMode === 'grid' ? (
                        <div className="resources-grid">
                            {(filteredItems as Resource[]).map((res) => (
                                <ResourceCard key={res.id} resource={res} onSelect={() => setSelectedResource(res)} downloadCount={downloadCounts.get(res.id) || 0} />
                            ))}
                        </div>
                    ) : (
                        <div className="resources-list-view">
                            {(filteredItems as Resource[]).map((res) => (
                                <ResourceListItem key={res.id} resource={res} onSelect={() => setSelectedResource(res)} downloadCount={downloadCounts.get(res.id) || 0} />
                            ))}
                        </div>
                    )
                ) : (
                    <div className="web-resource-list">
                       {(filteredItems as WebResource[]).map((res) => (
                           <WebResourceCard key={res.id} webResource={res} />
                       ))}
                    </div>
                )
            ) : (
                <div className="empty-state">
                    <h3>No Resources Found</h3>
                    <p>Try adjusting your search or filters, or be the first to contribute!</p>
                </div>
            )}

            {isUploadModalOpen && <UploadResourceModal onClose={() => setUploadModalOpen(false)} />}
            {selectedResource && <ResourceDetailsModal resource={selectedResource} onClose={() => setSelectedResource(null)} onUpdate={() => {setUpdatingResource(selectedResource); setSelectedResource(null);}} />}
            {updatingResource && <UpdateResourceModal resource={updatingResource} onClose={() => setUpdatingResource(null)} />}
            {isAddLinkModalOpen && <AddWebResourceModal onClose={() => setAddLinkModalOpen(false)} />}
        </div>
    );
};

const ResourceGridSkeleton = () => (
    <div className="resources-grid">
        {[...Array(6)].map((_, i) => <div key={i} className="skeleton-card"></div>)}
    </div>
);
const ResourceListSkeleton = () => (
     <div className="resources-list-view">
        {[...Array(4)].map((_, i) => <div key={i} className="skeleton-list-item"></div>)}
    </div>
);

const resourceTypeIcons = {
    book: Icons.bookOpen,
    notes: Icons.clipboardList,
    project: Icons.file,
    lab: Icons.beaker,
    other: Icons.file,
};

const ResourceCard = ({ resource, onSelect, downloadCount }: { resource: Resource, onSelect: () => void, downloadCount: number }) => {
    return (
        <div className="resource-card">
            <div className="resource-card-header">
                <span className="resource-card-icon">{resourceTypeIcons[resource.type]}</span>
                 <AIStatusPill status={resource.aiSafetyStatus} />
            </div>
            <h4 className="resource-card-title" title={resource.name}>{resource.name}</h4>
            <p className="resource-card-meta">
                <span>{resource.department}</span> | <span>{resource.subject}</span>
            </p>
             <p className="resource-card-meta">
                Uploaded by {resource.uploaderName}
             </p>
             <div className="resource-card-stats">
                <span title={`${downloadCount} downloads`}>{Icons.download} {downloadCount}</span>
                <span title={`Version ${resource.version}`}>{Icons.history} v{resource.version}</span>
                {resource.aiInsightsStatus === 'generating' && <span className="generating-indicator">{Icons.lightbulb} Generating Insights...</span>}
             </div>
            <div className="resource-card-footer">
                <button className="btn btn-secondary" onClick={onSelect}>View Details</button>
            </div>
        </div>
    );
};

const ResourceListItem = ({ resource, onSelect, downloadCount }: { resource: Resource, onSelect: () => void, downloadCount: number }) => {
    return (
        <div className="resource-list-item">
            <span className="resource-list-item-icon">{resourceTypeIcons[resource.type]}</span>
            <div className="resource-list-item-info">
                <h4 className="resource-list-item-title">{resource.name}</h4>
                <p className="resource-list-item-meta">{resource.department} | {resource.subject} | Uploaded by {resource.uploaderName}</p>
                 {resource.aiInsightsStatus === 'generating' && <span className="generating-indicator">{Icons.lightbulb} Generating Insights...</span>}
            </div>
            <div className="resource-list-item-stats">
                 <span title={`${downloadCount} downloads`}>{Icons.download} {downloadCount}</span>
                 <span title={`Version ${resource.version}`}>{Icons.history} v{resource.version}</span>
                 <span>{getRelativeTime(resource.timestamp)}</span>
            </div>
            <AIStatusPill status={resource.aiSafetyStatus} />
            <button className="btn btn-secondary btn-sm" onClick={onSelect}>Details</button>
        </div>
    );
};

const WebResourceCard = ({ webResource }: { webResource: WebResource }) => {
    return (
        <div className="web-resource-card">
            <div className="web-resource-card-content">
                <h4 className="web-resource-card-title">{webResource.title}</h4>
                <p className="web-resource-card-meta">{webResource.department} | {webResource.subject}</p>
                <p className="web-resource-card-summary">{webResource.summary}</p>
                <p className="web-resource-card-meta">
                    Added {getRelativeTime(webResource.timestamp)} by {webResource.addedByName}
                </p>
            </div>
            <div className="web-resource-card-actions">
                 <AIStatusPill status={webResource.aiStatus === 'approved' ? 'safe' : 'irrelevant'} />
                 <a href={webResource.url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
                    {Icons.externalLink} Open Link
                 </a>
            </div>
        </div>
    );
};


const AIStatusPill = ({ status }: { status: Resource['aiSafetyStatus'] | 'safe' | 'irrelevant' }) => {
    const statusConfig = {
        safe: { icon: Icons.shieldCheck, label: 'Safe', className: 'safe' },
        unsafe: { icon: Icons.shieldExclamation, label: 'Unsafe', className: 'unsafe' },
        irrelevant: { icon: Icons.warning, label: 'Irrelevant', className: 'irrelevant' },
        pending: { icon: <span className="spinner-sm" />, label: 'Pending', className: 'pending' },
    };
    const config = statusConfig[status];
    return (
        <span className={`ai-status-pill ${config.className}`}>
            {config.icon} {config.label}
        </span>
    );
};

const UploadResourceModal = ({ onClose }: { onClose: () => void }) => {
    const { currentUser, setResources, setResourceLogs, addNotification } = useAppContext();
    const [formData, setFormData] = useState({ name: '', type: 'notes' as Resource['type'], department: currentUser.dept, subject: '' });
    const [fileName, setFileName] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const file = e.target.files[0];
            setFileName(file.name);
            setFormData(prev => ({ ...prev, name: file.name.split('.').slice(0, -1).join('.') }));
        }
    };
    
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({...prev, [name]: value}));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!fileName || !formData.name || !formData.subject) {
            addNotification('Please fill all fields and select a file.', 'error');
            return;
        }
        if (!isAiEnabled || !ai) {
             addNotification('AI features are disabled. Cannot analyze upload.', 'warning');
             return;
        }

        setIsLoading(true);
        const prompt = `You are a security and academic relevance scanner for a university's digital library. Analyze the following resource details and determine if it's safe and appropriate.
        File Name: "${fileName}"
        Resource Type: "${formData.type}"
        Stated Subject: "${formData.subject}"
        
        Based ONLY on this information, provide your analysis. For safety, be cautious about executable-sounding names or suspicious terms. For relevance, ensure it sounds like academic material.

        Respond ONLY with a JSON object in this format:
        {
          "isSafe": boolean,
          "isRelevant": boolean,
          "reason": "A brief, one-sentence explanation for your decision."
        }`;

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: { responseMimeType: 'application/json' }
            });
            const analysis = JSON.parse(response.text);

            const newResource: Resource = {
                ...formData,
                id: uuidv4(),
                uploaderId: currentUser.id,
                uploaderName: currentUser.name,
                timestamp: Date.now(),
                fileName,
                aiSafetyStatus: !analysis.isSafe ? 'unsafe' : !analysis.isRelevant ? 'irrelevant' : 'safe',
                aiSafetyReason: analysis.reason,
                aiInsights: null,
                aiInsightsStatus: 'pending',
                version: 1,
            };

            setResources((prev: Resource[]) => [newResource, ...prev]);
            setResourceLogs((prev: ResourceLog[]) => [...prev, {
                id: uuidv4(),
                resourceId: newResource.id,
                resourceName: newResource.name,
                userId: currentUser.id,
                userName: currentUser.name,
                action: 'upload',
                timestamp: Date.now()
            }]);
            addNotification(`'${newResource.name}' uploaded. AI analysis will begin shortly.`, 'success');
            onClose();
        } catch (error) {
            console.error("AI Upload Analysis Error:", error);
            addNotification('Failed to analyze the uploaded resource.', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="modal-overlay open" onMouseDown={onClose}>
            <div className="modal-content" onMouseDown={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>Upload New Resource</h3>
                    <button onClick={onClose} className="close-modal-btn">&times;</button>
                </div>
                <form onSubmit={handleSubmit} className="modal-form">
                    <div className="control-group">
                        <label>File</label>
                        <button type="button" className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
                            {Icons.file} {fileName || 'Select a file'}
                        </button>
                        <input type="file" ref={fileInputRef} onChange={handleFileChange} style={{ display: 'none' }} />
                    </div>
                    <div className="control-group">
                        <label>Resource Name</label>
                        <input type="text" name="name" className="form-control" value={formData.name} onChange={handleInputChange} required />
                    </div>
                     <div className="control-group">
                        <label>Resource Type</label>
                        <select name="type" className="form-control" value={formData.type} onChange={handleInputChange}>
                            <option value="notes">Notes</option>
                            <option value="book">Book</option>
                            <option value="project">Project</option>
                            <option value="lab">Lab/Practical</option>
                            <option value="other">Other</option>
                        </select>
                    </div>
                     <div className="control-group">
                        <label>Department</label>
                        <select name="department" className="form-control" value={formData.department} onChange={handleInputChange}>
                             {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                    </div>
                     <div className="control-group">
                        <label>Subject</label>
                        <input type="text" name="subject" className="form-control" value={formData.subject} onChange={handleInputChange} required />
                    </div>
                    <div className="form-actions">
                        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isLoading}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={isLoading}>
                            {isLoading ? <span className="spinner-sm" /> : 'Upload & Analyze'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const AddWebResourceModal = ({ onClose }: { onClose: () => void }) => {
    const { currentUser, setWebResources, addNotification } = useAppContext();
    const [formData, setFormData] = useState({ url: '', department: currentUser.dept, subject: '' });
    const [isLoading, setIsLoading] = useState(false);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({...prev, [name]: value}));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.url || !formData.subject) {
            addNotification('Please provide a URL and a subject.', 'error');
            return;
        }
        if (!isAiEnabled || !ai) {
             addNotification('AI features are disabled. Cannot analyze link.', 'warning');
             return;
        }
        setIsLoading(true);

        const prompt = `You are an AI assistant curating a university's digital library. A user submitted a URL for a specific subject. Your task is to analyze it and provide structured metadata.
        URL: "${formData.url}"
        Intended Subject: "${formData.subject}"
        Intended Department: "${formData.department}"
        
        Generate a concise, clear title and a one-paragraph summary for this link, suitable for students and faculty. Also, assess if this link is academically relevant for the given context.
        
        Respond ONLY with a JSON object in this format:
        {
          "title": "A short, descriptive title",
          "summary": "A helpful summary of the content.",
          "isRelevant": true,
          "reason": "A brief, one-sentence explanation for your relevance decision."
        }`;

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: { responseMimeType: 'application/json' }
            });
            const analysis = JSON.parse(response.text);

            const newWebResource: WebResource = {
                id: uuidv4(),
                url: formData.url,
                title: analysis.title,
                summary: analysis.summary,
                department: formData.department,
                subject: formData.subject,
                addedById: currentUser.id,
                addedByName: currentUser.name,
                timestamp: Date.now(),
                aiStatus: analysis.isRelevant ? 'approved' : 'rejected',
                aiReason: analysis.reason,
            };

            setWebResources((prev: WebResource[]) => [newWebResource, ...prev]);
            addNotification(`Web link added. AI Status: ${newWebResource.aiStatus}.`, 'success');
            onClose();

        } catch (error) {
             console.error("AI Web Resource Analysis Error:", error);
            addNotification('Failed to analyze the web link.', 'error');
        } finally {
            setIsLoading(false);
        }
    };
    
    return (
        <div className="modal-overlay open" onMouseDown={onClose}>
            <div className="modal-content" onMouseDown={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>Add New Web Link</h3>
                    <button onClick={onClose} className="close-modal-btn">&times;</button>
                </div>
                <form onSubmit={handleSubmit} className="modal-form">
                    <div className="control-group">
                        <label>URL</label>
                        <input type="url" name="url" className="form-control" value={formData.url} onChange={handleInputChange} placeholder="https://example.com" required />
                    </div>
                    <div className="control-group">
                        <label>Department</label>
                        <select name="department" className="form-control" value={formData.department} onChange={handleInputChange}>
                             {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                    </div>
                     <div className="control-group">
                        <label>Subject</label>
                        <input type="text" name="subject" className="form-control" value={formData.subject} onChange={handleInputChange} required />
                    </div>
                    <div className="form-actions">
                        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isLoading}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={isLoading}>
                            {isLoading ? <span className="spinner-sm" /> : 'Add & Analyze'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const UpdateResourceModal = ({ resource, onClose }: { resource: Resource, onClose: () => void }) => {
    const { currentUser, setResources, setResourceUpdateLogs, addNotification } = useAppContext();
    const [newFileName, setNewFileName] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            setNewFileName(e.target.files[0].name);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newFileName) {
            addNotification('Please select a new file to update.', 'error');
            return;
        }
        if (newFileName === resource.fileName) {
            addNotification('The new file must be different from the current one.', 'warning');
            return;
        }
        if (!isAiEnabled || !ai) {
            addNotification('AI features are disabled. Cannot analyze update.', 'warning');
            return;
        }

        setIsLoading(true);
        const prompt = `You are an academic AI assistant. A user is updating a library resource. Generate a concise, one-sentence summary of the likely change based on the file name change.
        - Previous File: "${resource.fileName}"
        - New File: "${newFileName}"
        - Resource Name: "${resource.name}"
        - Subject: "${resource.subject}"

        Example response: "Updated the lecture notes to the revised version for the current academic year." or "Replaced the project report with a more detailed final version."`;

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt
            });
            const aiChangeSummary = response.text;

            const updatedResource: Resource = {
                ...resource,
                fileName: newFileName,
                timestamp: Date.now(),
                version: resource.version + 1,
                // Reset insights as the content has changed
                aiInsights: null,
                aiInsightsStatus: 'pending',
            };

            const updateLog: ResourceUpdateLog = {
                id: uuidv4(),
                resourceId: resource.id,
                timestamp: Date.now(),
                updatedByUserId: currentUser.id,
                updatedByUserName: currentUser.name,
                version: updatedResource.version,
                previousFileName: resource.fileName || 'N/A',
                newFileName: newFileName,
                aiChangeSummary,
            };

            setResources((prev: Resource[]) => prev.map(r => r.id === resource.id ? updatedResource : r));
            setResourceUpdateLogs((prev: ResourceUpdateLog[]) => [updateLog, ...prev]);
            addNotification(`'${resource.name}' updated successfully to version ${updatedResource.version}.`, 'success');
            onClose();
        } catch (error) {
            console.error("AI Update Analysis Error:", error);
            addNotification('Failed to analyze the resource update.', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="modal-overlay open" onMouseDown={onClose}>
            <div className="modal-content" onMouseDown={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>Update: {resource.name}</h3>
                    <button onClick={onClose} className="close-modal-btn">&times;</button>
                </div>
                <form onSubmit={handleSubmit} className="modal-form">
                    <p>Current file: <strong>{resource.fileName}</strong> (Version {resource.version})</p>
                    <div className="control-group">
                        <label>New File</label>
                        <button type="button" className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
                            {Icons.upload} {newFileName || 'Select a new file'}
                        </button>
                        <input type="file" ref={fileInputRef} onChange={handleFileChange} style={{ display: 'none' }} />
                    </div>
                    <div className="form-actions">
                        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isLoading}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={isLoading || !newFileName}>
                            {isLoading ? <span className="spinner-sm" /> : 'Update Resource'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};


const FilePreviewer = ({ resource }: { resource: Resource }) => {
    const renderContent = () => {
        const genericText = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.";
        switch (resource.type) {
            case 'lab':
                return (
                    <>
                        <h2>Lab Manual: {resource.name}</h2>
                        <h3>Experiment 1: Introduction to {resource.subject}</h3>
                        <h4>Objective</h4>
                        <p>To understand the fundamental concepts and basic operations of {resource.subject}. {genericText.substring(0, 200)}...</p>
                        <h4>Apparatus Required</h4>
                        <ul>
                            <li>Component A, Model #123</li>
                            <li>Component B, 5V Variant</li>
                            <li>Standard DC Power Supply</li>
                            <li>Connecting Wires</li>
                        </ul>
                        <h4>Procedure</h4>
                        <ol>
                            <li>Set up the apparatus as shown in the circuit diagram provided in Figure 1.1.</li>
                            <li>Ensure all connections are secure before powering on the device.</li>
                            <li>Apply an input voltage of 3.3V and observe the output on the oscilloscope.</li>
                            <li>Record the readings in the observation table below.</li>
                            <li>Repeat the process for input voltages of 5V and 9V.</li>
                            <li>{genericText.substring(0, 150)}...</li>
                        </ol>
                        <h4>Result</h4>
                        <p>The experiment was conducted successfully, and the results were found to be in accordance with theoretical values.</p>
                    </>
                );
            case 'book':
                 return (
                    <>
                        <h2>{resource.name}</h2>
                        <h3>Chapter 1: Introduction to {resource.subject}</h3>
                        <p>{genericText} {genericText}</p>
                        <h3>Chapter 2: Core Concepts and Principles</h3>
                        <p>{genericText} {genericText}</p>
                        <h3>Chapter 3: Advanced Topics</h3>
                        <p>{genericText}</p>
                    </>
                );
            case 'notes':
                return (
                    <>
                        <h2>Lecture Notes: {resource.subject}</h2>
                        <h3>Unit 1: {resource.name}</h3>
                        <p><strong>Key Topics Covered:</strong></p>
                        <ul>
                            <li>Topic 1.1 - A detailed explanation of the first key concept.</li>
                            <li>Topic 1.2 - An overview of the second important theory.</li>
                            <li>Topic 1.3 - Practical applications and examples.</li>
                        </ul>
                        <p>{genericText}</p>
                        <h4>Important Formulae:</h4>
                        <p>E = mc²</p>
                    </>
                );
            default:
                return (
                    <div className="empty-state">
                        <h3>Preview Not Available</h3>
                        <p>A detailed preview is not available for this file type.</p>
                    </div>
                );
        }
    };

    return <div className="file-preview-container">{renderContent()}</div>
};


const ResourceDetailsModal = ({ resource, onClose, onUpdate }: { resource: Resource, onClose: () => void, onUpdate: () => void }) => {
    const { currentUser, resources, setResourceLogs, addNotification, userNotes, setUserNotes, resourceUpdateLogs } = useAppContext();
    const [activeTab, setActiveTab] = useState<'preview' | 'insights' | 'qna' | 'notes' | 'history'>('preview');
    const currentResource = resources.find((r: Resource) => r.id === resource.id) || resource;

    const handleDownload = () => {
        setResourceLogs((prev: ResourceLog[]) => [...prev, {
            id: uuidv4(),
            resourceId: currentResource.id,
            resourceName: currentResource.name,
            userId: currentUser.id,
            userName: currentUser.name,
            action: 'download',
            timestamp: Date.now()
        }]);
        addNotification(`Downloading '${currentResource.name}'...`, 'info');
        onClose();
    };

    const currentNote = userNotes?.[currentResource.id] || '';
    const history = resourceUpdateLogs.filter((log: ResourceUpdateLog) => log.resourceId === currentResource.id).sort((a: ResourceUpdateLog, b: ResourceUpdateLog) => b.timestamp - a.timestamp);
    const canUpdate = ['admin', 'hod', 'faculty'].includes(currentUser.role);

    const handleNoteChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setUserNotes((prev: Record<string, string>) => ({
            ...prev,
            [currentResource.id]: e.target.value
        }));
    };

    return (
        <div className="modal-overlay open" onMouseDown={onClose}>
            <div className="modal-content resource-details-modal" onMouseDown={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>{currentResource.name}</h3>
                    <button onClick={onClose} className="close-modal-btn">&times;</button>
                </div>

                <div className="modal-tabs">
                    <button className={`modal-tab-button ${activeTab === 'preview' ? 'active' : ''}`} onClick={() => setActiveTab('preview')}>Preview</button>
                    <button className={`modal-tab-button ${activeTab === 'insights' ? 'active' : ''}`} onClick={() => setActiveTab('insights')}>{Icons.lightbulb} AI Insights</button>
                    <button className={`modal-tab-button ${activeTab === 'qna' ? 'active' : ''}`} onClick={() => setActiveTab('qna')}>{Icons.chatBubble} Q&A Forum</button>
                    <button className={`modal-tab-button ${activeTab === 'notes' ? 'active' : ''}`} onClick={() => setActiveTab('notes')}>My Notes</button>
                    <button className={`modal-tab-button ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>{Icons.history} History</button>
                </div>

                <div className="modal-tab-content">
                    {activeTab === 'preview' && <FilePreviewer resource={currentResource} />}
                    {activeTab === 'insights' && (
                        <AIInsightsView resource={currentResource} />
                    )}
                    {activeTab === 'qna' && <QnAForum resourceId={currentResource.id} />}
                    {activeTab === 'notes' && (
                        <textarea
                            className="notes-textarea"
                            placeholder="Write your personal notes for this resource here. They will be saved automatically and are only visible to you."
                            value={currentNote}
                            onChange={handleNoteChange}
                        />
                    )}
                    {activeTab === 'history' && (
                        <div className="history-log-container">
                            {history.length > 0 ? history.map(log => (
                                <div key={log.id} className="history-log-item">
                                    <div className="history-log-meta">
                                        <span className="history-log-version">Version {log.version}</span>
                                        <span className="history-log-author">by {log.updatedByUserName}</span>
                                        <span className="history-log-time">{getRelativeTime(log.timestamp)}</span>
                                    </div>
                                    <div className="history-log-details">
                                        <p>Updated file to <strong>{log.newFileName}</strong>.</p>
                                        {log.aiChangeSummary && (
                                            <blockquote className="ai-change-summary">
                                                <strong>AI Summary of Changes:</strong> {log.aiChangeSummary}
                                            </blockquote>
                                        )}
                                    </div>
                                </div>
                            )) : <p className="empty-state">No update history for this resource.</p>}
                        </div>
                    )}
                </div>

                <div className="form-actions">
                    <p className="resource-meta"><strong>File:</strong> {currentResource.fileName}</p>
                     <div className="button-group">
                        {canUpdate && <button className="btn btn-secondary" onClick={onUpdate}>{Icons.upload} Update File</button>}
                        <button className="btn btn-primary" onClick={handleDownload} disabled={currentResource.aiSafetyStatus === 'unsafe'}>
                            {Icons.download} {currentResource.aiSafetyStatus === 'unsafe' ? 'Download Blocked' : 'Download'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const AIInsightsView = ({ resource }: { resource: Resource }) => {
    const { resources } = useAppContext();
    const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string>>({});
    const [showResults, setShowResults] = useState<Record<number, boolean>>({});

    const handleAnswerSelect = (qIndex: number, option: string) => {
        setSelectedAnswers(prev => ({ ...prev, [qIndex]: option }));
        setShowResults(prev => ({ ...prev, [qIndex]: true }));
    };

    if (resource.aiInsightsStatus === 'generating' || resource.aiInsightsStatus === 'pending') {
        return (
            <div className="ai-insights-container loading">
                <div className="spinner"></div>
                <p>Generating AI Insights... This may take a moment.</p>
            </div>
        );
    }

    if (!resource.aiInsights || resource.aiInsightsStatus === 'failed') {
        return (
            <div className="empty-state">
                <h3>No AI Insights Available</h3>
                <p>Could not generate insights for this resource.</p>
            </div>
        );
    }
    
    const { summary, keyConcepts, quiz, relatedResourceIds } = resource.aiInsights;
    const relatedResources = resources.filter((r: Resource) => (relatedResourceIds || []).includes(r.id));

    return (
        <div className="ai-insights-container">
            <div className="insight-card">
                <h4>AI Summary</h4>
                <p>{summary}</p>
            </div>

            <div className="insight-card">
                <h4>Key Concepts</h4>
                <ul>
                    {keyConcepts.map((concept, i) => <li key={i}>{concept}</li>)}
                </ul>
            </div>
            
            <div className="insight-card">
                <h4>Test Your Knowledge</h4>
                <div className="quiz-container">
                    {quiz.map((q, i) => (
                        <div key={i} className="quiz-question">
                            <p><strong>{i + 1}. {q.question}</strong></p>
                            <div className="quiz-options">
                                {q.options.map((option, j) => {
                                    const isSelected = selectedAnswers[i] === option;
                                    const isCorrect = q.correctAnswer === option;
                                    let btnClass = 'quiz-option-btn';
                                    if (showResults[i]) {
                                        if (isCorrect) btnClass += ' correct';
                                        else if (isSelected && !isCorrect) btnClass += ' incorrect';
                                    }

                                    return (
                                        <button 
                                            key={j} 
                                            className={btnClass}
                                            onClick={() => handleAnswerSelect(i, option)}
                                            disabled={showResults[i]}
                                        >
                                            {option}
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {relatedResources.length > 0 && (
                <div className="insight-card">
                    <h4>Related Resources</h4>
                    <div className="related-resources-list">
                         {relatedResources.map(res => (
                            <div key={res.id} className="recommendation-card">
                                 <div className="recommendation-card-icon">{resourceTypeIcons[res.type]}</div>
                                 <div>
                                    <h4 className="recommendation-card-title">{res.name}</h4>
                                    <p className="recommendation-card-meta">{res.department} | {res.subject}</p>
                                 </div>
                            </div>
                         ))}
                    </div>
                </div>
            )}
        </div>
    );
};

const QnAForum = ({ resourceId }: { resourceId: string }) => {
    const { currentUser, qnaPosts, setQnaPosts, addNotification } = useAppContext();
    const [newQuestion, setNewQuestion] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const mainQuestions = useMemo(() => 
        qnaPosts.filter((p: QnAPost) => p.resourceId === resourceId && !p.parentId)
                .sort((a: QnAPost, b: QnAPost) => b.timestamp - a.timestamp), 
        [qnaPosts, resourceId]
    );

    const getReplies = useCallback((parentId: string) => 
        qnaPosts.filter((p: QnAPost) => p.parentId === parentId)
                .sort((a: QnAPost, b: QnAPost) => a.timestamp - b.timestamp),
        [qnaPosts]
    );
    
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newQuestion.trim()) return;

        setIsSubmitting(true);
        const post: QnAPost = {
            id: uuidv4(),
            resourceId,
            authorId: currentUser.id,
            authorName: currentUser.name,
            text: newQuestion,
            timestamp: Date.now(),
        };

        setQnaPosts((prev: QnAPost[]) => [...prev, post]);
        addNotification("Question posted!", 'success');
        setNewQuestion("");
        setIsSubmitting(false);
    };

    return (
        <div className="qna-forum">
            <form onSubmit={handleSubmit} className="qna-form">
                <textarea 
                    className="form-control"
                    placeholder="Have a question about this resource? Ask the community."
                    value={newQuestion}
                    onChange={e => setNewQuestion(e.target.value)}
                    rows={3}
                />
                <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                    {isSubmitting ? <span className="spinner-sm" /> : "Post Question"}
                </button>
            </form>
            <div className="qna-posts-list">
                {mainQuestions.length > 0 ? mainQuestions.map(post => (
                    <QnAPostView key={post.id} post={post} replies={getReplies(post.id)} getReplies={getReplies} />
                )) : (
                    <div className="empty-state">
                        <p>No questions yet. Be the first to ask!</p>
                    </div>
                )}
            </div>
        </div>
    );
};

const QnAPostView = ({ post, replies, getReplies }: { post: QnAPost, replies: QnAPost[], getReplies: (id: string) => QnAPost[] }) => {
    return (
        <div className="qna-post">
            <div className="qna-post-header">
                <span className="qna-author">{post.authorName}</span>
                <span className="qna-timestamp">{getRelativeTime(post.timestamp)}</span>
            </div>
            <p className="qna-text">{post.text}</p>
            <div className="qna-replies">
                {replies.map(reply => (
                    <QnAPostView key={reply.id} post={reply} replies={getReplies(reply.id)} getReplies={getReplies} />
                ))}
            </div>
        </div>
    )
};


const StudentDirectoryView = () => {
    const { users } = useAppContext();
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedStudent, setSelectedStudent] = useState<User | null>(null);

    const students = useMemo(() => {
        return users
            .filter((u: User) => u.role === 'student')
            .filter((u: User) => u.name.toLowerCase().includes(searchTerm.toLowerCase()))
            .sort((a: User, b: User) => a.name.localeCompare(b.name));
    }, [users, searchTerm]);

    return (
        <div className="directory-container">
            <div className="directory-header">
                <h2>Student Directory</h2>
                <div className="directory-controls">
                    <div className="search-bar">
                        {Icons.search}
                        <input
                            type="search"
                            placeholder="Search by student name..."
                            className="form-control"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>
            </div>
            <div className="student-grid">
                {students.length > 0 ? (
                    students.map((student: User) => (
                        <div key={student.id} className="student-card" onClick={() => setSelectedStudent(student)}>
                            <div className="student-card-avatar">{(student.name[0] || '').toUpperCase()}</div>
                            <div className="student-card-info">
                                <h4>{student.name}</h4>
                                <p>{student.dept} - Year {student.year}</p>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="empty-state">
                        <h3>No Students Found</h3>
                        <p>Your search for "{searchTerm}" did not return any results.</p>
                    </div>
                )}
            </div>
            {selectedStudent && <StudentDetailsModal student={selectedStudent} onClose={() => setSelectedStudent(null)} />}
        </div>
    );
};

const StudentDetailsModal = ({ student, onClose }: { student: User; onClose: () => void }) => {
    const [aiSummary, setAiSummary] = useState<string | null>(student.aiSummary || null);
    const [isLoading, setIsLoading] = useState(false);

    const getAiSummary = async () => {
        if (!isAiEnabled || !ai) return;
        setIsLoading(true);
        const prompt = `Generate a brief, one-paragraph academic performance summary for the following student. Be encouraging but realistic.
        - Name: ${student.name}
        - Grades: ${JSON.stringify(student.grades)}
        - Attendance: ${student.attendance?.present}/${student.attendance?.total} classes
        
        Focus on their strengths and areas for potential improvement based on the data.`;

        try {
            const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
            setAiSummary(response.text);
        } catch (error) {
            console.error("AI Student Summary Error:", error);
            setAiSummary("Could not generate summary at this time.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="modal-overlay open" onMouseDown={onClose}>
            <div className="modal-content student-details-modal" onMouseDown={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>{student.name}'s Profile</h3>
                    <button onClick={onClose} className="close-modal-btn">&times;</button>
                </div>
                <div className="student-details-content">
                    <h4>Academic Records</h4>
                    <p><strong>Department:</strong> {student.dept}, Year {student.year}</p>
                    <div className="student-details-section">
                        <h5>Grades</h5>
                        <ul>
                            {(student.grades || []).map(g => <li key={g.subject}>{g.subject}: <strong>{g.score}%</strong></li>)}
                        </ul>
                    </div>
                    <div className="student-details-section">
                        <h5>Attendance</h5>
                        <p>{student.attendance?.present || 0} / {student.attendance?.total || 0} classes attended</p>
                    </div>
                    <div className="student-details-section">
                        <h5>AI Performance Summary</h5>
                        {aiSummary ? (
                            <blockquote className="ai-change-summary">{aiSummary}</blockquote>
                        ) : (
                            <button className="btn btn-secondary" onClick={getAiSummary} disabled={isLoading}>
                                {isLoading ? <span className="spinner-sm" /> : <>{Icons.lightbulb} Generate Summary</>}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

const UserManagementView = () => {
    const { users, setUsers, addNotification } = useAppContext();

    const handleToggleLock = (userId: string) => {
        setUsers((prev: User[]) => prev.map(u => {
            if (u.id === userId) {
                addNotification(`${u.name}'s account has been ${u.isLocked ? 'unlocked' : 'locked'}.`, 'info');
                return { ...u, isLocked: !u.isLocked };
            }
            return u;
        }));
    };

    return (
        <div className="user-management-container">
            <div className="directory-header">
                <h2>User Management</h2>
            </div>
            <div className="table-wrapper">
                <table className="entry-list-table user-management-table">
                    <thead>
                        <tr>
                            <th>User</th>
                            <th>Role</th>
                            <th>Department/Year</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map((user: User) => (
                            <tr key={user.id}>
                                <td data-label="User">
                                    <div className="user-name-cell">
                                        <span>{user.name}</span>
                                        <small>{user.id}</small>
                                    </div>
                                </td>
                                <td data-label="Role">{user.role}</td>
                                <td data-label="Dept/Year">{user.dept}{user.year ? ` / ${user.year}`: ''}</td>
                                <td data-label="Status"><span className={`status-pill ${user.isLocked ? 'locked' : user.status}`}>{user.isLocked ? 'Locked' : user.status.replace('_', ' ')}</span></td>
                                <td data-label="Actions">
                                    <div className="item-actions">
                                        <button className="btn-action" title="Edit User">{Icons.editPencil}</button>
                                        <button className="btn-action" onClick={() => handleToggleLock(user.id)} title={user.isLocked ? "Unlock Account" : "Lock Account"}>
                                            {user.isLocked ? Icons.unlock : Icons.lock}
                                        </button>
                                        <button className="btn-action delete" title="Delete User">{Icons.delete}</button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const SecurityCenterView = () => {
    const { securityAlerts } = useAppContext();
    const [activeAlert, setActiveAlert] = useState<string | null>(null);

    const openAlerts = securityAlerts.filter(a => !a.isResolved).length;
    const criticalAlerts = securityAlerts.filter(a => !a.isResolved && a.severity === 'critical').length;
    const securityScore = Math.max(0, 100 - (openAlerts * 5) - (criticalAlerts * 20));

    return (
        <div className="security-center-container">
            <div className="guardian-dashboard-grid">
                <div className={`status-card ${securityScore > 80 ? 'severity-low' : securityScore > 50 ? 'severity-medium' : 'severity-high'}`}>
                    <div className="status-indicator">{Icons.shieldCheck}</div>
                    <div className="status-text">
                        <h4>Overall Security Score</h4>
                        <p>{securityScore} / 100</p>
                    </div>
                </div>
                <div className={`status-card ${openAlerts > 0 ? 'severity-high' : 'severity-low'}`}>
                    <div className="status-indicator">{Icons.warning}</div>
                    <div className="status-text">
                        <h4>Open Alerts</h4>
                        <p>{openAlerts}</p>
                    </div>
                </div>
                 <div className="guardian-actions">
                    <button className="btn btn-secondary">{Icons.clipboardList} View Audit Logs</button>
                    <button className="btn btn-secondary">{Icons.beaker} Run Security Drill</button>
                </div>
            </div>
            <div className="alert-list-container">
                 <h3>Active Security Alerts</h3>
                 <ul className="alert-list">
                    {securityAlerts.filter(a => !a.isResolved).sort((a,b) => b.timestamp - a.timestamp).map(alert => (
                        <SecurityAlertItem key={alert.id} alert={alert} isActive={activeAlert === alert.id} onToggle={() => setActiveAlert(activeAlert === alert.id ? null : alert.id)} />
                    ))}
                 </ul>
            </div>
        </div>
    );
};

const SecurityAlertItem = ({ alert, isActive, onToggle }: { alert: SecurityAlert, isActive: boolean, onToggle: () => void }) => {
    const { setSecurityAlerts, addNotification } = useAppContext();
    const handleResolve = (e: React.MouseEvent) => {
        e.stopPropagation();
        setSecurityAlerts((prev: SecurityAlert[]) => prev.map(a => a.id === alert.id ? {...a, isResolved: true} : a));
        addNotification(`Alert "${alert.title}" marked as resolved.`, 'success');
    };

    return (
        <li className={`alert-item severity-${alert.severity}`} onClick={onToggle} aria-expanded={isActive}>
             <div className="alert-item-header">
                <div className="alert-title">
                     <span className="severity-icon">{Icons.warning}</span>
                     <h5>{alert.title}</h5>
                </div>
                 <div className="alert-meta">
                    <span className={`status-pill severity-${alert.severity}`}>{alert.severity}</span>
                    <span>{getRelativeTime(alert.timestamp)}</span>
                 </div>
             </div>
             <p className="alert-description">{alert.description}</p>
             {isActive && (
                <div className="alert-details">
                    <div className="response-plan">
                        <h4>{Icons.guardian} AI Guardian Response Plan</h4>
                        <div className="response-plan-section">
                            <strong>Containment:</strong>
                            <p>{alert.responsePlan?.containment}</p>
                        </div>
                         <div className="response-plan-section">
                            <strong>Investigation:</strong>
                            <p>{alert.responsePlan?.investigation}</p>
                        </div>
                         <div className="response-plan-section">
                            <strong>Recovery:</strong>
                            <p>{alert.responsePlan?.recovery}</p>
                        </div>
                    </div>
                     <div className="alert-item-actions">
                         <button className="btn btn-secondary btn-sm">View Related Logs</button>
                         <button className="btn btn-success btn-sm" onClick={handleResolve}>Mark as Resolved</button>
                    </div>
                </div>
             )}
        </li>
    );
};

const AuthView = () => {
    const { users, setUsers, handleLogin, addNotification } = useAppContext();
    const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
    const [error, setError] = useState('');
    const [loadingProvider, setLoadingProvider] = useState<null | 'credentials' | 'google' | 'microsoft'>(null);

    // Login State
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');

    // Signup State
    const [signupName, setSignupName] = useState('');
    const [signupUsername, setSignupUsername] = useState('');
    const [signupPassword, setSignupPassword] = useState('');
    const [signupRole, setSignupRole] = useState<UserRole>('student');
    const [signupDept, setSignupDept] = useState(DEPARTMENTS[0]);
    const [signupYear, setSignupYear] = useState(YEARS[0]);
    const [passwordStrength, setPasswordStrength] = useState({ score: 0, feedback: '' });

    const handlePasswordChange = (pass: string) => {
        setSignupPassword(pass);
        let score = 0;
        let feedback = '';
        if (pass.length > 8) score++;
        if (pass.length > 12) score++;
        if (/[A-Z]/.test(pass)) score++;
        if (/[0-9]/.test(pass)) score++;
        if (/[^A-Za-z0-9]/.test(pass)) score++;

        if (pass.length === 0) {
            feedback = '';
        } else if (score < 3) {
            feedback = 'Weak. Try adding uppercase letters, numbers, or symbols.';
        } else if (score < 5) {
            feedback = 'Good. Could be stronger with more length or symbol variation.';
        } else {
            feedback = 'Strong password!';
        }
        setPasswordStrength({ score, feedback });
    };

    const handleLoginSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setLoadingProvider('credentials');
        setError('');

        setTimeout(() => { // Simulate network delay
            const user = users.find((u: User) => u.id === username);

            if (user && user.password === password) {
                if (user.status === 'pending_approval') {
                     setError('Your account is still pending approval.');
                } else if (user.status === 'rejected') {
                     setError('Your registration has been rejected. Please contact an administrator.');
                } else {
                    const loginSuccess = handleLogin(user);
                    if (!loginSuccess) {
                        setError('This account is currently locked. Please contact an administrator.');
                    }
                }
            } else {
                setError('Invalid username or password.');
            }
            setLoadingProvider(null);
        }, 500);
    };

    const handleSignupSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setLoadingProvider('credentials');
        setError('');

        if (!signupName || !signupUsername || !signupPassword) {
            setError('Please fill in all required fields.');
            setLoadingProvider(null);
            return;
        }

        setTimeout(() => { // Simulate network delay
            if (users.some((u: User) => u.id === signupUsername)) {
                setError('Username already exists. Please choose another.');
            } else {
                // Auto-approve the very first admin account
                const isAdminRegistration = signupRole === 'admin';
                const activeAdminExists = users.some((u: User) => u.role === 'admin' && u.status === 'active');
                const newStatus = (isAdminRegistration && !activeAdminExists) ? 'active' : 'pending_approval';

                const newUser: User = {
                    id: signupUsername,
                    name: signupName,
                    password: signupPassword,
                    role: signupRole,
                    dept: signupDept,
                    year: signupRole === 'student' ? signupYear : undefined,
                    status: newStatus,
                    hasCompletedOnboarding: false,
                    aiAssessment: "Standard user registration. No anomalies detected in provided information.",
                };
                setUsers((prevUsers: User[]) => [...prevUsers, newUser]);
                
                if (newStatus === 'active') {
                    addNotification('Admin account created and activated! You can now log in.', 'success');
                } else {
                    addNotification('Registration successful! Your account is pending administrator approval.', 'success');
                }

                setAuthMode('login');
                setUsername('');
                setPassword('');
                setSignupName('');
                setSignupUsername('');
                setSignupPassword('');
            }
            setLoadingProvider(null);
        }, 500);
    };
    
    const handleSocialLogin = (provider: 'google' | 'microsoft') => {
        setLoadingProvider(provider);
        setError('');
    
        setTimeout(() => {
            // In a real app, this would come from an OAuth provider and you'd get a stable ID.
            // For this demo, we generate a new user each time to show the approval flow.
            const socialUserData = {
                id: `${provider}-user-${Date.now()}`,
                name: `New ${provider.charAt(0).toUpperCase() + provider.slice(1)} User`,
                dept: provider === 'google' ? 'CSE' : 'ECE',
                year: provider === 'google' ? 'I' : 'II',
            };
            
            // This flow simulates a NEW user signing up via social media.
            // A full implementation would first check if a user with this social ID already exists.
            const newUser: User = {
                id: socialUserData.id,
                name: socialUserData.name,
                role: 'student', // Defaulting to student for social signups
                dept: socialUserData.dept,
                year: socialUserData.year,
                status: 'pending_approval',
                hasCompletedOnboarding: false,
                aiAssessment: `User registered via ${provider}. Standard checks passed.`,
            };
    
            setUsers((prevUsers: User[]) => [...prevUsers, newUser]);
            addNotification(`Account created with ${provider}. It is now pending administrator approval.`, 'success');
            setAuthMode('login'); // Go back to login screen to wait for approval
            setLoadingProvider(null);
            
        }, 1000);
    };


    return (
        <div className="login-view-container">
            <div className="login-card">
                <div className="login-header">
                    <span className="logo">{Icons.logo}</span>
                    <h1>{authMode === 'login' ? 'Welcome Back' : 'Create Account'}</h1>
                </div>

                {authMode === 'login' ? (
                    <form onSubmit={handleLoginSubmit}>
                        {error && <p className="auth-error">{error}</p>}
                        <div className="control-group">
                            <label htmlFor="username">Username</label>
                            <input
                                id="username"
                                type="text"
                                className="form-control"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder="e.g., student-alice"
                                required
                                autoCapitalize="none"
                            />
                        </div>
                        <div className="control-group">
                            <label htmlFor="password">Password</label>
                            <input
                                id="password"
                                type="password"
                                className="form-control"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="password"
                                required
                            />
                        </div>
                        <button type="submit" className="btn btn-primary" disabled={loadingProvider !== null} style={{marginTop: '0.5rem', width: '100%'}}>
                            {loadingProvider === 'credentials' ? <span className="spinner-sm"></span> : 'Login'}
                        </button>
                    </form>
                ) : (
                    <form onSubmit={handleSignupSubmit} className="signup-form">
                        {error && <p className="auth-error">{error}</p>}
                        <div className="control-group">
                            <label htmlFor="signupName">Full Name</label>
                            <input id="signupName" type="text" className="form-control" value={signupName} onChange={(e) => setSignupName(e.target.value)} required />
                        </div>
                        <div className="control-group">
                            <label htmlFor="signupUsername">Username</label>
                            <input id="signupUsername" type="text" className="form-control" value={signupUsername} onChange={(e) => setSignupUsername(e.target.value)} required autoCapitalize="none" />
                        </div>
                        <div className="control-group">
                            <label htmlFor="signupPassword">Password</label>
                            <input id="signupPassword" type="password" className="form-control" value={signupPassword} onChange={(e) => handlePasswordChange(e.target.value)} required />
                             {signupPassword && (
                                <div className={`password-strength-meter score-${passwordStrength.score}`}>
                                    <div className="strength-bar"></div>
                                    <small className="strength-feedback">{passwordStrength.feedback}</small>
                                </div>
                            )}
                        </div>
                        <div className="control-group">
                            <label htmlFor="signupRole">I am a...</label>
                            <select id="signupRole" className="form-control" value={signupRole} onChange={(e) => setSignupRole(e.target.value as UserRole)}>
                                <option value="student">Student</option>
                                <option value="faculty">Faculty</option>
                                <option value="admin">Administrator</option>
                            </select>
                        </div>
                        <div className="control-group">
                            <label htmlFor="signupDept">Department</label>
                            <select id="signupDept" className="form-control" value={signupDept} onChange={(e) => setSignupDept(e.target.value)}>
                                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </div>
                        {signupRole === 'student' && (
                            <div className="control-group">
                                <label htmlFor="signupYear">Year</label>
                                <select id="signupYear" className="form-control" value={signupYear} onChange={(e) => setSignupYear(e.target.value)}>
                                    {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                                </select>
                            </div>
                        )}
                        <button type="submit" className="btn btn-primary" disabled={loadingProvider !== null} style={{width: '100%'}}>
                            {loadingProvider === 'credentials' ? <span className="spinner-sm"></span> : 'Sign Up'}
                        </button>
                    </form>
                )}

                 <div className="social-login-divider">
                    <span>OR</span>
                </div>
                <div className="social-login-buttons">
                    <button className="btn btn-secondary social-btn" onClick={() => handleSocialLogin('google')} disabled={loadingProvider !== null}>
                        {loadingProvider === 'google' ? <span className="spinner-sm" /> : Icons.google} 
                        <span>Sign in with Google</span>
                    </button>
                    <button className="btn btn-secondary social-btn" onClick={() => handleSocialLogin('microsoft')} disabled={loadingProvider !== null}>
                       {loadingProvider === 'microsoft' ? <span className="spinner-sm" /> : Icons.microsoft} 
                        <span>Sign in with Microsoft</span>
                    </button>
                </div>

                <div className="auth-toggle">
                    {authMode === 'login' ? (
                        <>
                            Don't have an account?{' '}
                            <button onClick={() => { setAuthMode('signup'); setError(''); }}>Sign Up</button>
                        </>
                    ) : (
                        <>
                            Already have an account?{' '}
                            <button onClick={() => { setAuthMode('login'); setError(''); }}>Login</button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

const OracleVisualizer = ({ status }: { status: 'idle' | 'listening' | 'thinking' | 'speaking' }) => {
    return (
        <div className="oracle-visualizer" data-status={status}>
            <div className="oracle-glow"></div>
            <div className="oracle-orb"></div>
        </div>
    );
};


const Chatbot = () => {
    const { isChatbotOpen, setChatbotOpen, currentUser, addNotification } = useAppContext();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [aiStatus, setAiStatus] = useState<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
    const [isMuted, setIsMuted] = useState(true);
    const historyRef = useRef<HTMLDivElement>(null);
    const recognitionRef = useRef<any>(null);

    useEffect(() => {
        historyRef.current?.scrollTo({ top: historyRef.current.scrollHeight, behavior: 'smooth' });
    }, [messages]);

    useEffect(() => {
        // Speech Recognition setup
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognition) {
            recognitionRef.current = new SpeechRecognition();
            recognitionRef.current.continuous = false;
            recognitionRef.current.interimResults = false;

            recognitionRef.current.onstart = () => {
                setAiStatus('listening');
            };

            recognitionRef.current.onend = () => {
                setAiStatus('idle');
            };

            recognitionRef.current.onresult = (event: any) => {
                const transcript = event.results[0][0].transcript;
                setInput(transcript);
                handleSend(transcript); 
            };
            
            recognitionRef.current.onerror = (event: any) => {
                console.error('Speech recognition error:', event.error);
                addNotification(`Voice error: ${event.error}`, 'error');
                setAiStatus('idle');
            };

        }
    }, [addNotification]);
    
    const handleVoiceInput = () => {
        if (aiStatus === 'listening') {
            recognitionRef.current?.stop();
        } else {
             try {
                recognitionRef.current?.start();
            } catch(e) {
                addNotification('Voice recognition already active.', 'warning');
            }
        }
    };

    const speak = (text: string) => {
        if (isMuted || !('speechSynthesis' in window)) return;
        
        window.speechSynthesis.cancel(); // Cancel any previous speech
        const utterance = new SpeechSynthesisUtterance(text);
        
        utterance.onstart = () => setAiStatus('speaking');
        utterance.onend = () => setAiStatus('idle');
        utterance.onerror = () => setAiStatus('idle');

        window.speechSynthesis.speak(utterance);
    };

    const handleSend = async (textToSend?: string) => {
        const currentInput = textToSend || input;
        if (!currentInput.trim() || !isAiEnabled || !ai) return;

        const userMessage: ChatMessage = { id: uuidv4(), role: 'user', text: currentInput };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setAiStatus('thinking');
        window.speechSynthesis.cancel();

        const systemInstruction = currentUser?.role === 'admin'
            ? "You are JARVIS, a hyper-intelligent, witty, and friendly AI personal assistant for the college's Administrator. Address the admin directly and with a touch of personality, like a trusted colleague. Your goal is to provide precise, efficient support for managing the institution. Be proactive and anticipate needs where possible."
            : "You are AcademiaAI, a helpful assistant for a college management system. Your goal is to provide clear, concise, and relevant information to students, faculty, and administrators about their schedules, campus life, and academic queries. Be friendly and professional.";

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: currentInput,
                config: {
                    systemInstruction: systemInstruction
                }
            });
            const modelMessage: ChatMessage = { id: uuidv4(), role: 'model', text: response.text };
            setMessages(prev => [...prev, modelMessage]);
            speak(response.text);

        } catch (e) {
            console.error(e);
            const errorText = 'Sorry, I encountered an error.';
            const errorMessage: ChatMessage = { id: uuidv4(), role: 'model', text: errorText, isError: true };
            setMessages(prev => [...prev, errorMessage]);
            speak(errorText);
        } finally {
            if (aiStatus !== 'speaking') {
                 setAiStatus('idle');
            }
        }
    };
    
    return (
        <>
            <button className="chatbot-fab" onClick={() => setChatbotOpen(o => !o)} aria-label="Toggle AI Chatbot">
                {isChatbotOpen ? Icons.close : Icons.chatbot}
            </button>
            {isChatbotOpen && (
                <div className="chatbot-window">
                    <div className="chatbot-header">
                        <OracleVisualizer status={aiStatus} />
                        <h3>AI Voice Assistant</h3>
                        <button 
                            className={`speaker-btn ${isMuted ? 'muted' : ''}`}
                            onClick={() => {
                                setIsMuted(m => !m);
                                if (!isMuted) window.speechSynthesis.cancel();
                            }} 
                            aria-label={isMuted ? "Unmute voice" : "Mute voice"}
                        >
                            {isMuted ? Icons.speakerMute : Icons.speaker}
                        </button>
                    </div>
                    <div className="chatbot-history" ref={historyRef}>
                        {messages.length === 0 && <p className="no-history-text">Ask me anything about the schedule, faculty, or campus info.</p>}
                        {messages.map(msg => (
                             <div key={msg.id} className={`chat-message ${msg.role} ${msg.isError ? 'error' : ''}`}>
                                <div className="message-content" dangerouslySetInnerHTML={{ __html: marked.parse(msg.text) }}></div>
                            </div>
                        ))}
                         {aiStatus === 'thinking' && (
                            <div className="chat-message model">
                                <div className="message-content">
                                    <span className="thinking-dots"><span>.</span><span>.</span><span>.</span></span>
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="chatbot-input">
                         <button 
                            className={`mic-btn ${aiStatus === 'listening' ? 'listening' : ''}`}
                            onClick={handleVoiceInput}
                            disabled={!recognitionRef.current}
                            aria-label="Use voice input"
                        >
                            {Icons.microphone}
                        </button>
                        <input
                            type="text"
                            placeholder={aiStatus === 'listening' ? "Listening..." : "Ask a question..."}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && aiStatus !== 'thinking' && handleSend()}
                            disabled={aiStatus === 'thinking' || aiStatus === 'listening'}
                        />
                        <button onClick={() => handleSend()} disabled={aiStatus === 'thinking' || !input.trim()}>
                            {aiStatus === 'thinking' ? <span className="spinner-sm"></span> : Icons.send}
                        </button>
                    </div>
                </div>
            )}
        </>
    );
};


const OnboardingTour = () => {
    // Basic implementation placeholder
    return null;
};

const NotificationPortal = () => {
    const { notifications, setNotifications } = useAppContext();
    if (!notifications || notifications.length === 0) return null;

    const removeNotification = (id: string) => {
         setNotifications((current: AppNotification[]) => current.filter(n => n.id !== id));
    };

    return (
        <div className="notification-container">
            {notifications.map((n: AppNotification) => (
                 <div key={n.id} className={`notification-item ${n.type}`}>
                    <p className="notification-message">{n.message}</p>
                    <button className="notification-dismiss" onClick={() => removeNotification(n.id)}>&times;</button>
                </div>
            ))}
        </div>
    );
};

// --- RENDER ---
const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
} else {
    console.error("Root element not found");
}