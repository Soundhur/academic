/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
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
type AppView = 'dashboard' | 'timetable' | 'manage' | 'settings' | 'auth' | 'approvals' | 'announcements' | 'studentDirectory' | 'security' | 'userManagement' | 'resources' | 'academicCalendar';
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
    userName: string;
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

interface Collection {
    id: string;
    name: string;
    description: string;
    creatorId: string;
    creatorName: string;
    resourceIds: string[];
    department: string;
}

interface AcademicEvent {
    id: string;
    title: string;
    date: number; // timestamp for the start of the day
    type: 'exam' | 'holiday' | 'event';
    description: string;
}

interface AppSettings {
    timeSlots: string[];
    accentColor: string;
    // Add other settings here
}


const DEPARTMENTS = ["CSE", "ECE", "EEE", "MCA", "AI&DS", "CYBERSECURITY", "MECHANICAL", "TAMIL", "ENGLISH", "MATHS", "LIB", "NSS", "NET"];
const YEARS = ["I", "II", "III", "IV"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
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
    academicCalendar: { title: "Academic Calendar", icon: "calendarDays", roles: ['student', 'faculty', 'hod', 'admin', 'class advisor'] },
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

const sanitizeHtml = (htmlString: string): string => {
    // Basic sanitizer to prevent XSS. A library like DOMPurify is recommended for production.
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlString;

    // Remove dangerous tags
    const dangerousTags = ['script', 'style', 'iframe', 'object', 'embed'];
    dangerousTags.forEach(tagName => {
        const tags = tempDiv.getElementsByTagName(tagName);
        while (tags.length > 0) {
            tags[0].parentNode?.removeChild(tags[0]);
        }
    });

    // Remove event handlers and dangerous hrefs
    const allElements = tempDiv.getElementsByTagName('*');
    for (const element of Array.from(allElements)) {
        // Remove on* attributes
        for (const attr of Array.from(element.attributes)) {
            if (attr.name.toLowerCase().startsWith('on')) {
                element.removeAttribute(attr.name);
            }
        }
        // Check href/src for javascript protocol
        if (element.hasAttribute('href')) {
            const href = element.getAttribute('href') || '';
            if (href.toLowerCase().startsWith('javascript:')) {
                element.removeAttribute('href');
            }
        }
        if (element.hasAttribute('src')) {
            const src = element.getAttribute('src') || '';
            if (src.toLowerCase().startsWith('javascript:')) {
                element.removeAttribute('src');
            }
        }
    }

    return tempDiv.innerHTML;
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
    security: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.286zm-3 1.502a11.955 11.955 0 018.25 3.286M3 9.75a12.007 12.007 0 001.098 5.093" /></svg>,
    login: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" /></svg>,
    logout: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" /></svg>,
    users: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm6-11a4 4 0 11-8 0 4 4 0 018 0z" /></svg>,
    calendarDays: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.75 2a.75.75 0 01.75.75V4h7V2.75a.75.75 0 011.5 0V4h.25A2.75 2.75 0 0118 6.75v8.5A2.75 2.75 0 0115.25 18H4.75A2.75 2.75 0 012 15.25v-8.5A2.75 2.75 0 014.75 4H5V2.75A.75.75 0 015.75 2zM4.5 8.5a.75.75 0 000 1.5h.5a.75.75 0 000-1.5h-.5zM6 10a.75.75 0 01.75-.75h.5a.75.75 0 010 1.5h-.5A.75.75 0 016 10zm2.25.75a.75.75 0 000-1.5h.5a.75.75 0 000 1.5h-.5zM11 10a.75.75 0 01.75-.75h.5a.75.75 0 010 1.5h-.5a.75.75 0 01-.75-.75zm2.25.75a.75.75 0 000-1.5h.5a.75.75 0 000 1.5h-.5zM4.5 13.5a.75.75 0 000 1.5h.5a.75.75 0 000-1.5h-.5zM6 15a.75.75 0 01.75-.75h.5a.75.75 0 010 1.5h-.5A.75.75 0 016 15zm2.25.75a.75.75 0 000-1.5h.5a.75.75 0 000 1.5h-.5z" clipRule="evenodd" /></svg>,
    bookOpen: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M2 5.25A3.25 3.25 0 015.25 2h9.5A3.25 3.25 0 0118 5.25v9.5A3.25 3.25 0 0114.75 18h-9.5A3.25 3.25 0 012 14.75v-9.5zm3.25-.75c-.69 0-1.25.56-1.25 1.25v9.5c0 .69.56 1.25 1.25 1.25h3.5v-12h-3.5zM10 4.5v12h4.75c.69 0 1.25-.56 1.25-1.25v-9.5c0-.69-.56-1.25-1.25-1.25H10z" clipRule="evenodd" /></svg>,
    search: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" /></svg>,
    key: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" /></svg>,
    userCircle: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-5.5-2.5a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zM10 12a5.99 5.99 0 00-4.793 2.39A6.483 6.483 0 0010 16.5a6.483 6.483 0 004.793-2.11A5.99 5.99 0 0010 12z" clipRule="evenodd" /></svg>,
    lock: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" /></svg>,
    check: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.052-.143z" clipRule="evenodd" /></svg>,
    download: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" /><path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" /></svg>,
    upload: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M9.25 2.75a.75.75 0 011.5 0v8.614l2.955-3.129a.75.75 0 011.09 1.03l-4.25 4.5a.75.75 0 01-1.09 0l-4.25-4.5a.75.75 0 011.09-1.03L9.25 11.364V2.75z" /><path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" /></svg>,
    reset: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M15.312 11.342a1.25 1.25 0 010-1.768l-3.25-3.25a.75.75 0 011.06-1.06l3.25 3.25a2.75 2.75 0 010 3.888l-3.25 3.25a.75.75 0 11-1.06-1.06l3.25-3.25z" clipRule="evenodd" /><path fillRule="evenodd" d="M7.938 3.658a.75.75 0 011.06 1.06l-3.25 3.25a1.25 1.25 0 000 1.768l3.25 3.25a.75.75 0 11-1.06 1.06l-3.25-3.25a2.75 2.75 0 010-3.888l3.25-3.25z" clipRule="evenodd" /></svg>,
}

// --- DATA PERSISTENCE HOOK ---
function usePersistentState<T>(key: string, initialState: T): [T, React.Dispatch<React.SetStateAction<T>>] {
    const [state, setState] = useState<T>(() => {
        try {
            const storageValue = localStorage.getItem(key);
            return storageValue ? JSON.parse(storageValue) : initialState;
        } catch (error) {
            console.warn(`Error reading localStorage key "${key}":`, error);
            return initialState;
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem(key, JSON.stringify(state));
        } catch (error) {
            console.error(`Error writing to localStorage key "${key}":`, error);
        }
    }, [key, state]);

    return [state, setState];
}

// --- DEMO DATA GENERATION ---
const generateDemoData = () => {
    // Generate an admin user if none exists
    const users: User[] = [
        { id: 'admin-01', name: 'Admin', password: 'admin', role: 'admin', dept: 'System', status: 'active' }
    ];

    // Generate some faculty and students
    const facultyNames = ["Dr. Smith", "Prof. Jones", "Dr. Williams"];
    facultyNames.forEach((name, i) => {
        users.push({
            id: `faculty-0${i+1}`,
            name,
            password: 'password123',
            role: 'faculty',
            dept: DEPARTMENTS[i % 3], // Assign to first 3 depts
            status: 'active'
        });
    });

    const studentNames = ["Alice", "Bob", "Charlie", "David", "Eve"];
    studentNames.forEach((name, i) => {
        users.push({
            id: `student-0${i+1}`,
            name,
            password: 'password123',
            role: 'student',
            dept: DEPARTMENTS[i % 2], // CSE or ECE
            year: YEARS[i % 4],
            status: 'active',
            attendance: { present: Math.floor(Math.random() * 20) + 70, total: 100 },
            grades: [{ subject: 'Intro to AI', score: Math.floor(Math.random() * 30) + 65 }]
        });
    });

    const timetable: TimetableEntry[] = [];
    timetable.push({
        id: uuidv4(), department: 'CSE', year: 'II', day: 'Monday', timeIndex: 0,
        subject: 'Data Structures', type: 'class', faculty: 'Dr. Smith', room: 'CS-101'
    });
    timetable.push({
        id: uuidv4(), department: 'CSE', year: 'II', day: 'Monday', timeIndex: 1,
        subject: 'Algorithms', type: 'class', faculty: 'Dr. Smith', room: 'CS-102'
    });
    timetable.push({
        id: uuidv4(), department: 'ECE', year: 'III', day: 'Tuesday', timeIndex: 3,
        subject: 'Microprocessors', type: 'class', faculty: 'Prof. Jones', room: 'EC-201'
    });
     timetable.push({
        id: uuidv4(), department: 'CSE', year: 'II', day: 'Monday', timeIndex: 2,
        subject: 'Break', type: 'break'
    });


    const auditLogs: AuditLogEntry[] = [
        { id: uuidv4(), timestamp: Date.now() - 50000, userId: 'admin-01', userName: 'Admin', action: 'User Login', ip: '192.168.1.1', status: 'success' },
        { id: uuidv4(), timestamp: Date.now() - 80000, userId: 'unknown', userName: 'unknown', action: 'Failed Login Attempt', ip: '203.0.113.5', status: 'failure', details: 'Invalid credentials for user: hacker' },
    ];
    
    const securityAlerts: SecurityAlert[] = [
        {
            id: uuidv4(), type: 'Anomaly', title: 'Multiple Failed Logins',
            description: 'Detected 5 failed login attempts for user "Admin" from IP 203.0.113.5.',
            timestamp: Date.now() - 75000, severity: 'high', relatedUserId: 'admin-01',
            isResolved: false,
            responsePlan: {
                containment: "Temporarily block IP address 203.0.113.5.",
                investigation: "Verify if the attempts were made by the legitimate user.",
                recovery: "If legitimate, assist user with password reset. If malicious, maintain block.",
                recommendedAction: 'MONITOR'
            }
        },
    ];
    
    const settings: AppSettings = {
        timeSlots: TIME_SLOTS_DEFAULT,
        accentColor: '#3B82F6'
    };

    return { users, timetable, auditLogs, securityAlerts, settings };
};

// --- APP CONTEXT ---
interface AppContextType {
    currentUser: User | null;
    currentView: AppView;
    isSidebarOpen: boolean;
    theme: 'light' | 'dark';
    users: User[];
    timetableEntries: TimetableEntry[];
    auditLogs: AuditLogEntry[];
    securityAlerts: SecurityAlert[];
    settings: AppSettings;
    login: (username: string, pass: string) => boolean;
    logout: () => void;
    signup: (userData: Omit<User, 'id' | 'status'>) => { success: boolean, message: string };
    recoverPassword: (username: string, newPass: string) => boolean;
    findUsername: (dept: string, role: UserRole) => User | undefined;
    setCurrentView: (view: AppView) => void;
    toggleSidebar: () => void;
    setTheme: (theme: 'light' | 'dark') => void;
    addNotification: (message: string, type?: AppNotification['type']) => void;
    addAuditLog: (log: Omit<AuditLogEntry, 'id' | 'timestamp'>) => void;
    resolveSecurityAlert: (alertId: string) => void;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
    updateUser: (updatedUser: User) => void;
    resetAllData: () => void;
    importData: (data: string) => boolean;
}

const AppContext = createContext<AppContextType | null>(null);

const AppProvider = ({ children }: { children: React.ReactNode }) => {
    const [isInitialized, setIsInitialized] = useState(false);
    const [currentUser, setCurrentUser] = usePersistentState<User | null>('currentUser', null);
    const [currentView, setCurrentView] = useState<AppView>(currentUser ? 'dashboard' : 'auth');
    const [isSidebarOpen, setSidebarOpen] = useState(false);
    const [theme, setTheme] = usePersistentState<'light' | 'dark'>('theme', 'light');
    const [notifications, setNotifications] = useState<AppNotification[]>([]);

    const [users, setUsers] = usePersistentState<User[]>('app_users', []);
    const [timetableEntries, setTimetableEntries] = usePersistentState<TimetableEntry[]>('app_timetable', []);
    const [auditLogs, setAuditLogs] = usePersistentState<AuditLogEntry[]>('app_auditLogs', []);
    const [securityAlerts, setSecurityAlerts] = usePersistentState<SecurityAlert[]>('app_securityAlerts', []);
    const [settings, setSettings] = usePersistentState<AppSettings>('app_settings', {
        timeSlots: TIME_SLOTS_DEFAULT,
        accentColor: '#3B82F6',
    });
    
    useEffect(() => {
        // One-time initialization of demo data if the database is empty
        const isDataInitialized = localStorage.getItem('isDataInitialized');
        if (!isDataInitialized) {
            const demoData = generateDemoData();
            setUsers(demoData.users);
            setTimetableEntries(demoData.timetable);
            setAuditLogs(demoData.auditLogs);
            setSecurityAlerts(demoData.securityAlerts);
            setSettings(demoData.settings);
            localStorage.setItem('isDataInitialized', 'true');
        }
        setIsInitialized(true);
    }, []);

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
    }, [theme]);
    
    useEffect(() => {
        // Apply accent color
        document.documentElement.style.setProperty('--accent-primary', settings.accentColor);
        // A slightly lighter shade for hover, calculated simply
        const accentColor = settings.accentColor || '#3B82F6';
        if (accentColor.startsWith('#')) {
             let r = parseInt(accentColor.slice(1, 3), 16);
             let g = parseInt(accentColor.slice(3, 5), 16);
             let b = parseInt(accentColor.slice(5, 7), 16);
             r = Math.min(255, r + 20);
             g = Math.min(255, g + 20);
             b = Math.min(255, b + 20);
             const hoverColor = `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
             document.documentElement.style.setProperty('--accent-primary-hover', hoverColor);
        }

    }, [settings.accentColor]);

    const addNotification = (message: string, type: AppNotification['type'] = 'info') => {
        const newNotif = { id: uuidv4(), message, type };
        setNotifications(prev => [...prev, newNotif]);
        setTimeout(() => {
            setNotifications(prev => prev.filter(n => n.id !== newNotif.id));
        }, 5000);
    };

    const addAuditLog = useCallback((log: Omit<AuditLogEntry, 'id' | 'timestamp'>) => {
        const newLog = { ...log, id: uuidv4(), timestamp: Date.now() };
        setAuditLogs(prev => [newLog, ...prev]);
    }, [setAuditLogs]);

    const login = (username: string, pass: string): boolean => {
        const user = users.find(u => u.name.toLowerCase() === username.toLowerCase() && u.password === pass);
        if (user) {
            if (user.isLocked) {
                addNotification("Your account is locked. Please contact an administrator.", 'error');
                addAuditLog({ userId: user.id, userName: user.name, action: 'Login Attempt (Locked Account)', ip: 'local', status: 'failure' });
                return false;
            }
            setCurrentUser(user);
            setCurrentView('dashboard');
            addNotification(`Welcome back, ${user.name}!`, 'success');
            addAuditLog({ userId: user.id, userName: user.name, action: 'User Login', ip: 'local', status: 'success' });
            return true;
        }
        addAuditLog({ userId: 'unknown', userName: username, action: 'Failed Login Attempt', ip: 'local', status: 'failure' });
        addNotification("Invalid username or password.", 'error');
        return false;
    };
    
    const signup = (userData: Omit<User, 'id'|'status'>) => {
        const existingUser = users.find(u => u.name.toLowerCase() === userData.name.toLowerCase());
        if (existingUser) {
            return { success: false, message: "Username already exists." };
        }
        const newUser: User = { ...userData, id: uuidv4(), status: 'active' };
        setUsers(prev => [...prev, newUser]);
        addAuditLog({ userId: newUser.id, userName: newUser.name, action: 'User Signup', ip: 'local', status: 'success' });
        return { success: true, message: "Account created successfully!" };
    };

    const recoverPassword = (username: string, newPass: string) => {
        const userIndex = users.findIndex(u => u.name.toLowerCase() === username.toLowerCase());
        if (userIndex !== -1) {
            const updatedUsers = [...users];
            updatedUsers[userIndex].password = newPass;
            setUsers(updatedUsers);
            addAuditLog({ userId: updatedUsers[userIndex].id, userName: username, action: 'Password Recovery', ip: 'local', status: 'success' });
            return true;
        }
        return false;
    };

    const findUsername = (dept: string, role: UserRole) => {
        return users.find(u => u.dept === dept && u.role === role);
    };

    const logout = () => {
        if (currentUser) {
            addAuditLog({ userId: currentUser.id, userName: currentUser.name, action: 'User Logout', ip: 'local', status: 'info' });
        }
        setCurrentUser(null);
        setCurrentView('auth');
    };

    const toggleSidebar = () => setSidebarOpen(!isSidebarOpen);
    
    const resolveSecurityAlert = (alertId: string) => {
        setSecurityAlerts(prev => prev.map(alert =>
            alert.id === alertId ? { ...alert, isResolved: true } : alert
        ));
        addNotification("Alert has been marked as resolved.", 'info');
        addAuditLog({ userId: currentUser?.id || 'system', userName: currentUser?.name || 'System', action: `Resolved Security Alert ${alertId}`, ip: 'local', status: 'info' });
    };

    const updateUser = (updatedUser: User) => {
        setUsers(prev => prev.map(u => u.id === updatedUser.id ? updatedUser : u));
    };

    const resetAllData = () => {
        if (window.confirm("Are you sure you want to reset all application data? This action cannot be undone.")) {
            localStorage.clear();
            setCurrentUser(null);
            const demoData = generateDemoData();
            setUsers(demoData.users);
            setTimetableEntries(demoData.timetable);
            setAuditLogs(demoData.auditLogs);
            setSecurityAlerts(demoData.securityAlerts);
            setSettings(demoData.settings);
            localStorage.setItem('isDataInitialized', 'true');
            addNotification("All application data has been reset to default.", "success");
            setCurrentView('auth');
        }
    };

    const importData = (dataStr: string) => {
        try {
            const data = JSON.parse(dataStr);
            if (data.app_users && data.app_timetable && data.app_settings) {
                 if (window.confirm("Are you sure you want to import this data? This will overwrite all current application data.")) {
                    localStorage.setItem('app_users', JSON.stringify(data.app_users));
                    setUsers(data.app_users);
                    localStorage.setItem('app_timetable', JSON.stringify(data.app_timetable));
                    setTimetableEntries(data.app_timetable);
                    localStorage.setItem('app_auditLogs', JSON.stringify(data.app_auditLogs || []));
                    setAuditLogs(data.app_auditLogs || []);
                    localStorage.setItem('app_securityAlerts', JSON.stringify(data.app_securityAlerts || []));
                    setSecurityAlerts(data.app_securityAlerts || []);
                    localStorage.setItem('app_settings', JSON.stringify(data.app_settings));
                    setSettings(data.app_settings);
                    
                    localStorage.setItem('isDataInitialized', 'true');
                    addNotification("Data imported successfully!", "success");
                    logout(); // Force re-login
                    return true;
                }
            } else {
                addNotification("Invalid data file format.", "error");
                return false;
            }
        } catch (error) {
            addNotification("Failed to parse data file.", "error");
            console.error(error);
            return false;
        }
        return false;
    };

    if (!isInitialized) {
        return <div className="loading-fullscreen"><div className="spinner"></div></div>;
    }

    const value = {
        currentUser,
        currentView,
        isSidebarOpen,
        theme,
        users,
        timetableEntries,
        auditLogs,
        securityAlerts,
        settings,
        login,
        logout,
        signup,
        recoverPassword,
        findUsername,
        setCurrentView,
        toggleSidebar,
        setTheme,
        addNotification,
        addAuditLog,
        resolveSecurityAlert,
        setSettings,
        updateUser,
        resetAllData,
        importData,
    };

    return (
        <AppContext.Provider value={value}>
            {children}
            <NotificationPortal notifications={notifications} removeNotification={(id) => setNotifications(p => p.filter(n => n.id !== id))} />
        </AppContext.Provider>
    );
};

const useAppContext = () => {
    const context = useContext(AppContext);
    if (!context) {
        throw new Error('useAppContext must be used within an AppProvider');
    }
    return context;
};

// --- COMPONENTS ---

const NotificationPortal = ({ notifications, removeNotification }: { notifications: AppNotification[], removeNotification: (id: string) => void }) => {
    return createPortal(
        <div className="notification-container">
            {notifications.map(notification => (
                <div key={notification.id} className={`notification-item ${notification.type}`}>
                    <span>{notification.message}</span>
                    <button className="notification-dismiss" onClick={() => removeNotification(notification.id)}>&times;</button>
                </div>
            ))}
        </div>,
        document.body
    );
};

const Modal = ({ isOpen, onClose, title, children, size = 'md' }: { isOpen: boolean, onClose: () => void, title: string, children: React.ReactNode, size?: 'md' | 'lg' | 'xl' }) => {
    if (!isOpen) return null;

    const sizeClasses = {
        md: 'student-details-modal', // default max-width: 500px
        lg: 'resource-details-modal', // max-width: 900px
        xl: 'modal-xl' // You'd need to add a class for this
    }

    return createPortal(
        <div className={`modal-overlay ${isOpen ? 'open' : ''}`} onMouseDown={onClose}>
            <div className={`modal-content ${sizeClasses[size]}`} onMouseDown={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>{title}</h3>
                    <button className="close-modal-btn" onClick={onClose}>&times;</button>
                </div>
                {children}
            </div>
        </div>,
        document.body
    );
};

const Sidebar = () => {
    const { currentUser, currentView, setCurrentView, logout, isSidebarOpen, toggleSidebar } = useAppContext();
    const visibleViews = Object.entries(APP_VIEWS_CONFIG).filter(([, config]) =>
        currentUser && config.roles.includes(currentUser.role)
    );

    return (
        <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
            <div className="sidebar-header">
                <span className="logo">{Icons.logo}</span>
                <h1>AcademiaAI</h1>
                <button className="sidebar-close" onClick={toggleSidebar}>{Icons.close}</button>
            </div>
            <nav className="nav-list">
                {visibleViews.map(([viewKey, config]) => (
                    <li className="nav-item" key={viewKey}>
                        <button
                            className={currentView === viewKey ? 'active' : ''}
                            onClick={() => {
                                setCurrentView(viewKey as AppView);
                                if (isSidebarOpen) toggleSidebar();
                            }}
                        >
                            {Icons[config.icon]}
                            <span>{config.title}</span>
                        </button>
                    </li>
                ))}
            </nav>
            <div className="sidebar-footer">
                <button className="nav-item" onClick={logout}>
                    {Icons.logout}
                    <span>Logout</span>
                </button>
            </div>
        </aside>
    );
};

const Header = () => {
    const { currentUser, currentView, toggleSidebar, theme, setTheme } = useAppContext();
    const viewTitle = APP_VIEWS_CONFIG[currentView]?.title || "Dashboard";

    return (
        <header className="header">
            <div className="header-left">
                <button className="menu-toggle" onClick={toggleSidebar}>{Icons.menu}</button>
                <h2 className="header-title">{viewTitle}</h2>
            </div>
            <div className="header-right">
                <div className="user-info">
                    <strong>{currentUser?.name}</strong><br />
                    <small>{currentUser?.role} - {currentUser?.dept}</small>
                </div>
                <button className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
                    {theme === 'light' ? Icons.moon : Icons.sun}
                </button>
            </div>
        </header>
    );
};

const AuthView = () => {
    const { login, signup, addNotification, recoverPassword, findUsername } = useAppContext();
    const [isLoginView, setIsLoginView] = useState(true);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [role, setRole] = useState<UserRole>('student');
    const [dept, setDept] = useState(DEPARTMENTS[0]);
    const [year, setYear] = useState(YEARS[0]);

    const [isRecoveryModalOpen, setRecoveryModalOpen] = useState(false);
    const [recoveryMode, setRecoveryMode] = useState<'user' | 'pass'>('pass');
    const [recoveryUsername, setRecoveryUsername] = useState('');
    const [recoveryNewPass, setRecoveryNewPass] = useState('');
    const [recoveryDept, setRecoveryDept] = useState(DEPARTMENTS[0]);
    const [recoveryRole, setRecoveryRole] = useState<UserRole>('student');


    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (isLoginView) {
            login(username, password);
        } else {
            if (password !== confirmPassword) {
                addNotification("Passwords do not match.", 'error');
                return;
            }
            const signupData: Omit<User, 'id' | 'status'> = {
                name: username,
                password,
                role,
                dept: role === 'admin' ? 'System' : dept,
                year: role === 'student' ? year : undefined,
            };
            const { success, message } = signup(signupData);
            if (success) {
                addNotification(message, 'success');
                setIsLoginView(true); // Flip back to login view
                // Optionally clear password fields
                setPassword('');
                setConfirmPassword('');
            } else {
                addNotification(message, 'error');
            }
        }
    };
    
    const handleRecovery = () => {
        if (recoveryMode === 'pass') {
            if(recoverPassword(recoveryUsername, recoveryNewPass)) {
                addNotification(`Password for ${recoveryUsername} has been updated.`, 'success');
                setRecoveryModalOpen(false);
            } else {
                addNotification(`User ${recoveryUsername} not found.`, 'error');
            }
        } else {
            const foundUser = findUsername(recoveryDept, recoveryRole);
            if(foundUser) {
                alert(`The username is: ${foundUser.name}`);
                setRecoveryModalOpen(false);
            } else {
                addNotification(`No user found with the specified role and department.`, 'error');
            }
        }
    };


    return (
        <div className="login-view-container">
            <div className="login-card">
                <div className={`login-card-inner ${!isLoginView ? 'is-flipped' : ''}`}>
                    {/* Login Form */}
                    <div className="login-card-front">
                        <div className="login-header">
                            <span className="logo">{Icons.logo}</span>
                            <h1>Welcome Back</h1>
                        </div>
                        <form onSubmit={handleSubmit}>
                            <div className="control-group">
                                <label htmlFor="login-username">Username</label>
                                <input type="text" id="login-username" className="form-control" value={username} onChange={e => setUsername(e.target.value)} required />
                            </div>
                            <div className="control-group">
                                <label htmlFor="login-password">Password</label>
                                <input type="password" id="login-password" className="form-control" value={password} onChange={e => setPassword(e.target.value)} required />
                            </div>
                            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }}>
                                Sign In
                            </button>
                            <div className="auth-toggle" style={{display: 'flex', justifyContent: 'space-between', padding: '0 0.5rem'}}>
                                <button type="button" onClick={() => { setRecoveryMode('pass'); setRecoveryModalOpen(true); }}>Forgot Password?</button>
                                <button type="button" onClick={() => { setRecoveryMode('user'); setRecoveryModalOpen(true); }}>Forgot Username?</button>
                            </div>
                        </form>
                        <div className="auth-toggle">
                            Don't have an account?
                            <button onClick={() => setIsLoginView(false)}>Sign Up</button>
                        </div>
                    </div>
                    {/* Sign Up Form */}
                    <div className="login-card-back">
                        <div className="login-header">
                            <span className="logo">{Icons.logo}</span>
                            <h1>Create Account</h1>
                        </div>
                        <form onSubmit={handleSubmit}>
                            <div className="control-group">
                                <label htmlFor="signup-username">Username</label>
                                <input type="text" id="signup-username" className="form-control" value={username} onChange={e => setUsername(e.target.value)} required />
                            </div>
                            <div className="control-group">
                                <label htmlFor="signup-password">Password</label>
                                <input type="password" id="signup-password" className="form-control" value={password} onChange={e => setPassword(e.target.value)} required />
                            </div>
                            <div className="control-group">
                                <label htmlFor="confirmPassword">Confirm Password</label>
                                <input type="password" id="confirmPassword" className="form-control" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required />
                            </div>
                            <div className="form-grid">
                                <div className="control-group">
                                    <label htmlFor="role">Role</label>
                                    <select id="role" className="form-control" value={role} onChange={e => setRole(e.target.value as UserRole)}>
                                        <option value="student">Student</option>
                                        <option value="faculty">Faculty</option>
                                        <option value="hod">HOD</option>
                                        <option value="class advisor">Class Advisor</option>
                                        <option value="admin">Admin</option>
                                    </select>
                                </div>
                                {role !== 'admin' && (
                                    <div className="control-group">
                                        <label htmlFor="dept">Department</label>
                                        <select id="dept" className="form-control" value={dept} onChange={e => setDept(e.target.value)}>
                                            {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                                        </select>
                                    </div>
                                )}
                            </div>
                            {role === 'student' && (
                                <div className="control-group">
                                    <label htmlFor="year">Year</label>
                                    <select id="year" className="form-control" value={year} onChange={e => setYear(e.target.value)}>
                                        {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                                    </select>
                                </div>
                            )}
                            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }}>
                                Sign Up
                            </button>
                        </form>
                        <div className="auth-toggle">
                            Already have an account?
                            <button onClick={() => setIsLoginView(true)}>Sign In</button>
                        </div>
                    </div>
                </div>
            </div>
            <Modal isOpen={isRecoveryModalOpen} onClose={() => setRecoveryModalOpen(false)} title="Account Recovery">
                <div className="modal-form">
                {recoveryMode === 'pass' ? (
                    <>
                        <h4>Password Recovery</h4>
                        <div className="control-group">
                            <label htmlFor="rec-username">Enter your Username</label>
                            <input type="text" id="rec-username" className="form-control" value={recoveryUsername} onChange={e => setRecoveryUsername(e.target.value)} />
                        </div>
                         <div className="control-group">
                            <label htmlFor="rec-newpass">Enter New Password</label>
                            <input type="password" id="rec-newpass" className="form-control" value={recoveryNewPass} onChange={e => setRecoveryNewPass(e.target.value)} />
                        </div>
                    </>
                ) : (
                     <>
                        <h4>Username Recovery</h4>
                        <div className="control-group">
                            <label htmlFor="rec-role">Select your Role</label>
                             <select id="rec-role" className="form-control" value={recoveryRole} onChange={e => setRecoveryRole(e.target.value as UserRole)}>
                                {['student', 'faculty', 'hod', 'admin', 'class advisor'].map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                        </div>
                         <div className="control-group">
                            <label htmlFor="rec-dept">Select your Department</label>
                            <select id="rec-dept" className="form-control" value={recoveryDept} onChange={e => setRecoveryDept(e.target.value)}>
                                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </div>
                    </>
                )}
                <div className="form-actions">
                    <button className="btn btn-secondary" onClick={() => setRecoveryModalOpen(false)}>Cancel</button>
                    <button className="btn btn-primary" onClick={handleRecovery}>Recover</button>
                </div>
                </div>
            </Modal>
        </div>
    );
};

const DashboardView = () => {
    const { currentUser } = useAppContext();
    return (
        <div className="dashboard-container">
            <h2 className="dashboard-greeting">Welcome, {currentUser?.name}!</h2>
            <div className="dashboard-card">
                <h3>Today's Schedule</h3>
                <p>You have 4 classes and 1 meeting today.</p>
            </div>
            <div className="dashboard-card">
                <h3>Activity Feed</h3>
                <div className="feed-list">
                    <div className="feed-item-card class stagger-item" style={{ animationDelay: '100ms' }}>
                        <div className="feed-item-icon">{Icons.timetable}</div>
                        <div>
                            <p className="feed-item-title">Next Class: Data Structures</p>
                            <p className="feed-item-meta">10:50 AM in CS-101 with Dr. Smith</p>
                        </div>
                    </div>
                    <div className="feed-item-card announcement stagger-item" style={{ animationDelay: '200ms' }}>
                        <div className="feed-item-icon">{Icons.announcement}</div>
                        <div>
                            <p className="feed-item-title">New Announcement: Symposium '24</p>
                            <p className="feed-item-meta">Posted by HOD (CSE) - 2 hours ago</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const TimetableView = () => {
    const { currentUser, timetableEntries, settings } = useAppContext();
    const [department, setDepartment] = useState(currentUser?.dept || DEPARTMENTS[0]);
    const [year, setYear] = useState(currentUser?.role === 'student' ? currentUser.year || YEARS[0] : YEARS[0]);

    const filteredEntries = useMemo(() => {
        return timetableEntries.filter(e => e.department === department && e.year === year);
    }, [timetableEntries, department, year]);

    const grid = useMemo(() => {
        const newGrid: (TimetableEntry | null)[][] = Array(settings.timeSlots.length).fill(0).map(() => Array(5).fill(null));
        filteredEntries.forEach(entry => {
            const dayIndex = DAYS.indexOf(entry.day);
            if (dayIndex >= 0 && dayIndex < 5) { // Only Monday to Friday
                if (entry.timeIndex >= 0 && entry.timeIndex < settings.timeSlots.length) {
                    newGrid[entry.timeIndex][dayIndex] = entry;
                }
            }
        });
        return newGrid;
    }, [filteredEntries, settings.timeSlots]);

    return (
        <div className="timetable-container">
            <div className="timetable-header">
                <h3>Class Timetable</h3>
                <div className="timetable-controls">
                    <select className="form-control" value={department} onChange={e => setDepartment(e.target.value)}>
                        {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <select className="form-control" value={year} onChange={e => setYear(e.target.value)}>
                        {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                </div>
            </div>
            <div className="timetable-wrapper">
                <div className="timetable-grid">
                    <div className="grid-header">Time</div>
                    {DAYS.slice(0, 5).map(day => <div key={day} className="grid-header">{day}</div>)}

                    {settings.timeSlots.map((slot, timeIndex) => (
                        <React.Fragment key={timeIndex}>
                            <div className="time-slot">{slot}</div>
                            {grid[timeIndex].map((entry, dayIndex) => (
                                <div key={`${timeIndex}-${dayIndex}`} className={`grid-cell ${entry?.type || ''}`}>
                                    {entry && (
                                        <>
                                            <span className="subject">{entry.subject}</span>
                                            {entry.faculty && <span className="faculty">{entry.faculty}</span>}
                                        </>
                                    )}
                                </div>
                            ))}
                        </React.Fragment>
                    ))}
                </div>
            </div>
        </div>
    );
};

const ManageTimetableView = () => {
    const { timetableEntries } = useAppContext();
    return (
        <div className="manage-timetable-container">
            <div className="entry-form">
                <h3>Add/Edit Timetable Entry</h3>
                {/* Form would go here */}
            </div>
            <div className="entry-list-container">
                <h3>Current Entries</h3>
                <div className="table-wrapper">
                    <table className="entry-list-table">
                        <thead>
                            <tr>
                                <th>Dept</th>
                                <th>Year</th>
                                <th>Day</th>
                                <th>Time</th>
                                <th>Subject</th>
                                <th>Faculty</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {timetableEntries.map(entry => (
                                <tr key={entry.id}>
                                    <td data-label="Dept">{entry.department}</td>
                                    <td data-label="Year">{entry.year}</td>
                                    <td data-label="Day">{entry.day}</td>
                                    <td data-label="Time">{TIME_SLOTS_DEFAULT[entry.timeIndex]}</td>
                                    <td data-label="Subject">{entry.subject}</td>
                                    <td data-label="Faculty">{entry.faculty || '-'}</td>
                                    <td data-label="Actions">
                                        <div className="entry-actions">
                                            <button>{Icons.editPencil}</button>
                                            <button className="delete-btn">{Icons.delete}</button>
                                        </div>
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

const StudentDirectoryView = () => {
    const { users, addNotification } = useAppContext();
    const [searchQuery, setSearchQuery] = useState('');
    const [isAiSearching, setIsAiSearching] = useState(false);
    const [filters, setFilters] = useState({ department: 'all', year: 'all' });
    const [selectedStudent, setSelectedStudent] = useState<User | null>(null);
    const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);

    const students = useMemo(() => users.filter(u => u.role === 'student'), [users]);

    const filteredStudents = useMemo(() => {
        return students.filter(student => {
            const departmentMatch = filters.department === 'all' || student.dept === filters.department;
            const yearMatch = filters.year === 'all' || student.year === filters.year;
            const searchMatch = student.name.toLowerCase().includes(searchQuery.toLowerCase());
            return departmentMatch && yearMatch && searchMatch;
        });
    }, [students, filters, searchQuery]);
    
    const handleAiSearch = async () => {
        if (!ai) {
            addNotification("AI features are disabled.", "warning");
            return;
        }
        if (!searchQuery) return;

        setIsAiSearching(true);
        try {
            const prompt = `Parse the following user query to filter a list of students.
            Query: "${searchQuery}"
            Available filters are 'department' (values: ${DEPARTMENTS.join(', ')}), and 'year' (values: ${YEARS.join(', ')}).
            Also, interpret qualitative terms like "low attendance" (less than 75%), "good attendance" (>= 75%), "excellent attendance" (>=90%), "top performers" (grade score > 90), or "poor performers" (grade score < 60).
            Respond ONLY with a JSON object containing the identified filters. For example: {"department": "CSE", "year": "II"}. If no filters are found, respond with an empty JSON object.`;

            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: { responseMimeType: "application/json" }
            });

            const resultJson = JSON.parse(response.text);
            const newFilters = { department: 'all', year: 'all' };
            if (resultJson.department && DEPARTMENTS.includes(resultJson.department)) {
                newFilters.department = resultJson.department;
            }
             if (resultJson.year && YEARS.includes(resultJson.year)) {
                newFilters.year = resultJson.year;
            }
            setFilters(newFilters);
            addNotification("AI search applied.", "info");

        } catch (error) {
            console.error("AI Search Error:", error);
            addNotification("AI search failed. Please try a simpler query.", "error");
        } finally {
            setIsAiSearching(false);
        }
    };

    const handleGenerateSummary = async () => {
        if(!ai || !selectedStudent) return;
        setIsGeneratingSummary(true);
        try {
            const studentData = {
                name: selectedStudent.name,
                department: selectedStudent.dept,
                year: selectedStudent.year,
                attendance: selectedStudent.attendance,
                grades: selectedStudent.grades
            };
            const prompt = `Generate a brief, analytical academic summary for the following student. Highlight their strengths and potential areas for improvement based on their grades and attendance.
            Student Data: ${JSON.stringify(studentData)}`;
            
            const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
            
            const summary = response.text;
            // This would normally be saved back to the user object
            setSelectedStudent(prev => prev ? {...prev, aiSummary: summary} : null);

        } catch(e) {
            console.error(e);
            addNotification("Failed to generate AI summary.", "error");
        } finally {
            setIsGeneratingSummary(false);
        }
    }

    return (
        <div className="directory-container">
            <div className="directory-header">
                <div className="search-bar" style={{ flexGrow: 1 }}>
                    {Icons.search}
                    <input
                        type="text"
                        className="form-control"
                        placeholder="Search by name or use AI..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                         onKeyDown={e => e.key === 'Enter' && handleAiSearch()}
                    />
                     {isAiSearching && <div className="search-spinner"><div className="spinner-sm"></div></div>}
                </div>
                <div className="directory-controls">
                     <button className="btn btn-secondary" onClick={handleAiSearch} disabled={isAiSearching}>
                        {isAiSearching ? "Thinking..." : "AI Search"}
                    </button>
                    <select className="form-control" value={filters.department} onChange={e => setFilters(f => ({...f, department: e.target.value}))}>
                        <option value="all">All Departments</option>
                        {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <select className="form-control" value={filters.year} onChange={e => setFilters(f => ({...f, year: e.target.value}))}>
                        <option value="all">All Years</option>
                        {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                </div>
            </div>
            <div className="student-grid">
                {filteredStudents.map((student, index) => (
                    <div className="student-card stagger-item" key={student.id} onClick={() => setSelectedStudent(student)} style={{ animationDelay: `${index * 50}ms` }}>
                        <div className="student-card-avatar">{student.name.charAt(0)}</div>
                        <div className="student-card-info">
                            <h4>{student.name}</h4>
                            <p>{student.dept} - Year {student.year}</p>
                            {student.attendance && (
                                <div className="attendance-bar-container">
                                    <div
                                        className={`attendance-bar ${student.attendance.present / student.attendance.total > 0.9 ? 'good' : student.attendance.present / student.attendance.total > 0.75 ? 'fair' : 'poor'}`}
                                        style={{ width: `${(student.attendance.present / student.attendance.total) * 100}%` }}
                                        title={`Attendance: ${student.attendance.present}%`}
                                    ></div>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
            {selectedStudent && (
                <Modal isOpen={!!selectedStudent} onClose={() => setSelectedStudent(null)} title={`Student Details: ${selectedStudent.name}`}>
                    <div className="student-details-content">
                        <div className="student-details-section">
                            <h5>AI Academic Summary</h5>
                            {selectedStudent.aiSummary ? (
                                <p className="ai-assessment">{selectedStudent.aiSummary}</p>
                            ) : (
                                <p>No AI summary generated yet.</p>
                            )}
                            <button className="btn btn-sm btn-secondary" onClick={handleGenerateSummary} disabled={isGeneratingSummary}>
                                {isGeneratingSummary ? <div className="spinner-sm"></div> : null}
                                {selectedStudent.aiSummary ? 'Regenerate' : 'Generate Summary'}
                            </button>
                        </div>
                         <div className="student-details-section">
                             <h5>Details</h5>
                             <p><strong>Department:</strong> {selectedStudent.dept}</p>
                             <p><strong>Year:</strong> {selectedStudent.year}</p>
                         </div>
                         <div className="student-details-section">
                             <h5>Performance</h5>
                             <p><strong>Attendance:</strong> {selectedStudent.attendance?.present || 'N/A'}%</p>
                             <p><strong>Latest Grade:</strong> {selectedStudent.grades?.[0]?.subject} - {selectedStudent.grades?.[0]?.score || 'N/A'}</p>
                         </div>
                    </div>
                </Modal>
            )}
        </div>
    );
};

const SecurityView = () => {
    const { auditLogs, securityAlerts, resolveSecurityAlert, addNotification } = useAppContext();
    const [selectedAlert, setSelectedAlert] = useState<SecurityAlert | null>(null);
    const [selectedLogs, setSelectedLogs] = useState<Set<string>>(new Set());
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisResult, setAnalysisResult] = useState('');

    const handleSelectLog = (logId: string) => {
        setSelectedLogs(prev => {
            const newSet = new Set(prev);
            if (newSet.has(logId)) {
                newSet.delete(logId);
            } else {
                newSet.add(logId);
            }
            return newSet;
        });
    };
    
    const analyzeSelectedLogs = async () => {
        if (!ai) {
            addNotification("AI features are disabled.", "warning");
            return;
        }
        if (selectedLogs.size === 0) {
            addNotification("Please select at least one log to analyze.", "info");
            return;
        }

        setIsAnalyzing(true);
        setAnalysisResult('');

        const logsToAnalyze = auditLogs.filter(log => selectedLogs.has(log.id));
        const prompt = `As a cybersecurity expert, analyze the following security audit logs for potential threats, suspicious patterns, or coordinated malicious activity. Provide a brief, actionable summary of your findings and recommend a course of action.
        
        Logs:
        ${JSON.stringify(logsToAnalyze, null, 2)}`;

        try {
            const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
            setAnalysisResult(response.text);
        } catch (error) {
            console.error("AI Analysis Error:", error);
            setAnalysisResult("An error occurred during AI analysis. Please try again.");
            addNotification("AI analysis failed.", "error");
        } finally {
            setIsAnalyzing(false);
        }
    };


    const unresolvedAlerts = securityAlerts.filter(a => !a.isResolved);

    return (
        <div className="security-center-container">
            <div className="guardian-dashboard-grid">
                 <div className="status-card severity-medium">
                    <div className="status-indicator">{Icons.security}</div>
                    <div className="status-text">
                        <h4>System Status</h4>
                        <p>All Systems Go</p>
                    </div>
                 </div>
                 <div className="status-card severity-high">
                     <div className="status-indicator">{Icons.announcement}</div>
                    <div className="status-text">
                        <h4>Unresolved Alerts</h4>
                        <p>{unresolvedAlerts.length}</p>
                    </div>
                 </div>
            </div>
            
            <div className="alert-list-container">
                <h3>Active Security Alerts</h3>
                <ul className="alert-list">
                    {unresolvedAlerts.map((alert, index) => (
                        <li key={alert.id} className={`alert-item severity-${alert.severity} stagger-item`} onClick={() => setSelectedAlert(alert.id === selectedAlert?.id ? null : alert)} style={{ animationDelay: `${index * 50}ms` }}>
                           <div className="alert-item-header">
                                <span className="alert-title"><strong>{alert.title}</strong></span>
                                <span className="alert-meta">{getRelativeTime(alert.timestamp)}</span>
                           </div>
                           <p className="alert-description">{alert.description}</p>
                            {selectedAlert?.id === alert.id && (
                                <div className="alert-details">
                                    {alert.responsePlan && (
                                        <div className="response-plan">
                                            <h4>Recommended Response</h4>
                                            <p className="response-plan-section"><strong>Containment:</strong> {alert.responsePlan.containment}</p>
                                            <p className="response-plan-section"><strong>Investigation:</strong> {alert.responsePlan.investigation}</p>
                                            <p className="response-plan-section"><strong>Recovery:</strong> {alert.responsePlan.recovery}</p>
                                        </div>
                                    )}
                                    <div className="alert-item-actions">
                                        <button className="btn btn-sm btn-success" onClick={(e) => { e.stopPropagation(); resolveSecurityAlert(alert.id); setSelectedAlert(null); }}>Mark as Resolved</button>
                                        {alert.responsePlan?.recommendedAction === 'LOCK_USER' && <button className="btn btn-sm btn-danger">Lock User Account</button>}
                                    </div>
                                </div>
                            )}
                        </li>
                    ))}
                    {unresolvedAlerts.length === 0 && <p>No active alerts.</p>}
                </ul>
            </div>
            
            <div className="entry-list-container">
                 <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem'}}>
                    <h3>Audit Log</h3>
                    <button className="btn btn-primary" onClick={analyzeSelectedLogs} disabled={isAnalyzing || selectedLogs.size === 0}>
                        {isAnalyzing ? <div className="spinner-sm"></div> : null}
                        Analyze Selected ({selectedLogs.size})
                    </button>
                </div>
                {analysisResult && (
                    <div className="ai-change-summary" style={{marginBottom: '1rem'}}>
                         <h4>AI Analysis Result:</h4>
                         <p>{analysisResult}</p>
                    </div>
                )}
                <div className="table-wrapper">
                    <table className="entry-list-table">
                        <thead>
                            <tr>
                                <th></th>
                                <th>Timestamp</th>
                                <th>User</th>
                                <th>Action</th>
                                <th>Status</th>
                                <th>IP Address</th>
                            </tr>
                        </thead>
                        <tbody>
                            {auditLogs.map((log, index) => (
                                <tr key={log.id} className="stagger-item" style={{ animationDelay: `${index * 30}ms` }}>
                                    <td><input type="checkbox" checked={selectedLogs.has(log.id)} onChange={() => handleSelectLog(log.id)} /></td>
                                    <td data-label="Timestamp">{new Date(log.timestamp).toLocaleString()}</td>
                                    <td data-label="User">{log.userName}</td>
                                    <td data-label="Action">{log.action}</td>
                                    <td data-label="Status"><span className={`status-pill ${log.status === 'success' ? 'active' : log.status === 'failure' ? 'rejected' : ''}`}>{log.status}</span></td>
                                    <td data-label="IP">{log.ip}</td>
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
    const { settings, setSettings, resetAllData, importData, addNotification } = useAppContext();
    const [timeSlotsText, setTimeSlotsText] = useState(settings.timeSlots.join('\n'));
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleTimeSlotsSave = () => {
        const newSlots = timeSlotsText.split('\n').filter(slot => slot.trim() !== '');
        setSettings(prev => ({ ...prev, timeSlots: newSlots }));
        addNotification("Time slots updated successfully!", "success");
    };

    const handleAccentColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSettings(prev => ({...prev, accentColor: e.target.value}));
    };
    
    const handleExport = () => {
        const dataToExport = {
            app_users: JSON.parse(localStorage.getItem('app_users') || '[]'),
            app_timetable: JSON.parse(localStorage.getItem('app_timetable') || '[]'),
            app_auditLogs: JSON.parse(localStorage.getItem('app_auditLogs') || '[]'),
            app_securityAlerts: JSON.parse(localStorage.getItem('app_securityAlerts') || '[]'),
            app_settings: JSON.parse(localStorage.getItem('app_settings') || '{}'),
        };
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(dataToExport, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", `academia_ai_backup_${new Date().toISOString().split('T')[0]}.json`);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
        addNotification("Data exported successfully.", "success");
    };
    
    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const text = e.target?.result;
                if(typeof text === 'string') {
                    importData(text);
                }
            };
            reader.readAsText(file);
        }
    };

    return (
        <div className="dashboard-container">
            <div className="dashboard-card">
                <h3>General Settings</h3>
                 <div className="control-group">
                    <label htmlFor="accent-color">Accent Color</label>
                    <input type="color" id="accent-color" value={settings.accentColor} onChange={handleAccentColorChange} style={{padding: 0, border: 'none', height: '40px', width: '100px', background: 'none'}}/>
                </div>
            </div>
             <div className="dashboard-card">
                <h3>Timetable Configuration</h3>
                <div className="control-group">
                    <label htmlFor="time-slots">Time Slots (one per line)</label>
                    <textarea 
                        id="time-slots" 
                        className="form-control" 
                        rows={10} 
                        value={timeSlotsText}
                        onChange={e => setTimeSlotsText(e.target.value)}
                    ></textarea>
                </div>
                <button className="btn btn-primary" onClick={handleTimeSlotsSave}>Save Time Slots</button>
            </div>
            <div className="dashboard-card">
                <h3>Data Management</h3>
                <p>Manage the application's data. Be careful, these actions can be destructive.</p>
                <div style={{display: 'flex', gap: '1rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                    <button className="btn btn-secondary" onClick={handleExport}>{Icons.download} Export Data</button>
                     <input type="file" ref={fileInputRef} onChange={handleFileChange} style={{ display: 'none' }} accept=".json" />
                    <button className="btn btn-secondary" onClick={handleImportClick}>{Icons.upload} Import Data</button>
                    <button className="btn btn-danger" onClick={resetAllData}>{Icons.delete} Reset All Data</button>
                </div>
            </div>
        </div>
    );
};


const PageContent = () => {
    const { currentView } = useAppContext();

    switch (currentView) {
        case 'dashboard': return <DashboardView />;
        case 'timetable': return <TimetableView />;
        case 'manage': return <ManageTimetableView />;
        case 'studentDirectory': return <StudentDirectoryView />;
        case 'security': return <SecurityView />;
        case 'settings': return <SettingsView />;
        default: return <DashboardView />;
    }
};

const App = () => {
    const { currentUser, isSidebarOpen, toggleSidebar } = useAppContext();

    if (!currentUser) {
        return <AuthView />;
    }

    return (
        <div className={`app-container ${isSidebarOpen ? 'sidebar-open' : ''}`}>
            <Sidebar />
            <div className="sidebar-overlay" onClick={toggleSidebar}></div>
            <main className="main-content">
                <Header />
                <div className="page-content">
                    <PageContent />
                </div>
            </main>
        </div>
    );
};

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(
        <React.StrictMode>
            <AppProvider>
                <App />
            </AppProvider>
        </React.StrictMode>
    );
}