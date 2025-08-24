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
interface TimetableEntry {
    id: string;
    department: string;
    year: string;
    day: string;
    timeIndex: number;
    subject: string;
    type: 'break' | 'class' | 'common';
    faculty?: string;
    room?: string;
}
interface Announcement {
    id: string;
    title: string;
    content: string;
    author: string; // e.g., "Admin", "HOD (CSE)"
    timestamp: number;
    targetRole: 'all' | 'student' | 'faculty';
    targetDept: 'all' | 'CSE' | 'ECE' | 'EEE' | 'MCA' | 'AI&DS' | 'CYBERSECURITY' | 'MECHANICAL' | 'TAMIL' | 'ENGLISH' | 'MATHS' | 'LIB' | 'NSS' | 'NET';
    reactions?: { [emoji: string]: string[] }; // Emoji: [userId1, userId2]
}
interface ChatMessage {
    id: string;
    role: 'user' | 'model';
    text: string;
    isError?: boolean;
}

type UserRole = 'student' | 'faculty' | 'hod' | 'admin' | 'class advisor' | 'principal' | 'creator';
type AppView = 'dashboard' | 'timetable' | 'manage' | 'settings' | 'auth' | 'approvals' | 'announcements' | 'studentDirectory' | 'security' | 'userManagement' | 'resources' | 'academicCalendar' | 'courseFiles';

interface User {
    id: string;
    name: string;
    password?: string;
    role: UserRole;
    dept: string;
    year?: string;
    status: 'active' | 'pending_approval' | 'rejected';
    aiSummary?: string;
    grades?: { subject: string; score: number }[]; // For students
    attendance?: { present: number; total: number }; // For students
    isLocked?: boolean;
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
    source?: 'local' | 'gdrive' | 'onedrive';
}

interface OnlineCourse {
    id: string;
    title: string;
    platform: string;
    url: string;
    description: string;
    tags: string[];
}

interface CourseFile {
    id: string;
    facultyId: string;
    facultyName: string;
    department: string;
    subject: string;
    semester: string;
    files: { name: string; type: 'syllabus' | 'notes' | 'quiz' }[];
    status: 'pending_review' | 'approved' | 'needs_revision';
    submittedAt: number;
    aiReview?: {
        summary: string;
        suggestions: string[];
        corrections?: { original: string; corrected: string; }[];
        status: 'pending' | 'complete' | 'failed';
    };
}

interface CalendarEvent {
    id: string;
    date: Date;
    title: string;
    type: 'exam' | 'holiday' | 'event' | 'deadline';
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

interface AppSettings {
    timeSlots: string[];
    accentColor: string;
}

const DEPARTMENTS = ["CSE", "ECE", "EEE", "MCA", "AI&DS", "CYBERSECURITY", "MECHANICAL", "TAMIL", "ENGLISH", "MATHS", "LIB", "NSS", "NET"];
const YEARS = ["I", "II", "III", "IV"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TIME_SLOTS_DEFAULT = [
    "9:00 - 9:50", "9:50 - 10:35", "10:35 - 10:50", "10:50 - 11:35", "11:35 - 12:20",
    "12:20 - 1:05", "1:05 - 2:00", "2:00 - 2:50", "2:50 - 3:40", "3:40 - 4:30"
];

const APP_VIEWS_CONFIG: Record<AppView, { title: string; icon: keyof typeof Icons; roles: UserRole[] }> = {
    dashboard: { title: "For You", icon: "dashboard", roles: ['student', 'faculty', 'hod', 'admin', 'class advisor', 'principal', 'creator'] },
    timetable: { title: "Timetable", icon: "timetable", roles: ['student', 'faculty', 'hod', 'admin', 'class advisor', 'principal', 'creator'] },
    academicCalendar: { title: "Academic Calendar", icon: "calendarDays", roles: ['student', 'faculty', 'hod', 'admin', 'class advisor', 'principal', 'creator'] },
    resources: { title: "Resources", icon: "bookOpen", roles: ['student', 'faculty', 'hod', 'admin', 'class advisor', 'principal', 'creator'] },
    studentDirectory: { title: "Student Directory", icon: "users", roles: ['faculty', 'hod', 'class advisor', 'admin', 'principal', 'creator'] },
    courseFiles: { title: "Course Files", icon: 'folder', roles: ['faculty', 'hod', 'admin', 'class advisor', 'principal', 'creator'] },
    approvals: { title: "Approvals", icon: "approvals", roles: ['hod', 'admin', 'principal', 'creator'] },
    announcements: { title: "Announcements", icon: "announcement", roles: ['student', 'faculty', 'hod', 'admin', 'class advisor', 'principal', 'creator'] },
    manage: { title: "Manage Timetable", icon: "edit", roles: ['admin', 'creator'] },
    userManagement: { title: "User Management", icon: "users", roles: ['admin', 'principal', 'creator'] },
    security: { title: "Security Center", icon: "security", roles: ['admin', 'principal', 'creator'] },
    settings: { title: "Settings", icon: "settings", roles: ['admin', 'creator'] },
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
    logo: <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L3 7v10l9 5 9-5V7l-9-5zM12 22.08V12M12 12L3.5 7.5M12 12l8.5-4.5M20.5 7.5L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
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
    check: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.052-.143z" clipRule="evenodd" /></svg>,
    download: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" /><path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" /></svg>,
    upload: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M9.25 2.75a.75.75 0 011.5 0v8.614l2.955-3.129a.75.75 0 011.09 1.03l-4.25 4.5a.75.75 0 01-1.09 0l-4.25-4.5a.75.75 0 011.09-1.03L9.25 11.364V2.75z" /><path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" /></svg>,
    cloud: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M5.5 16a3.5 3.5 0 01-.369-6.98 4 4 0 117.753-1.977A4.5 4.5 0 1113.5 16h-8z" /></svg>,
    react: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM7 9a1 1 0 100-2 1 1 0 000 2zm7-1a1 1 0 11-2 0 1 1 0 012 0zm-.464 5.535a.75.75 0 01.083-1.06 5 5 0 00-8.238 0 .75.75 0 01-1.144-.974 6.5 6.5 0 0110.526 0 .75.75 0 01-1.06.083z" clipRule="evenodd" /></svg>,
    googleDrive: <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15.0001 9.52L8.50006 20.52L12.5001 13.52H8.50006L15.0001 2.52L11.0001 9.52H15.0001Z" fill="#34A853"/><path d="M21.5 9.51995L15 20.52L19 13.52H15L21.5 2.51995L17.5 9.51995H21.5Z" fill="#FFC107"/><path d="M2.5 9.51995L9 20.52L5 13.52H9L2.5 2.51995L6.5 9.51995H2.5Z" fill="#4285F4"/></svg>,
    oneDrive: <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 8H13C14.1046 8 15 8.89543 15 10V17C15 18.1046 14.1046 19 13 19H4C2.89543 19 2 18.1046 2 17V10C2 8.89543 2.89543 8 4 8Z" fill="#0072C6"/><path d="M11 5H20C21.1046 5 22 5.89543 22 7V14C22 15.1046 21.1046 16 20 16H11C9.89543 16 9 15.1046 9 14V7C9 5.89543 9.89543 5 11 5Z" fill="#0072C6"/></svg>,
    folder: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" /></svg>,
    file: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 2a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V8.414a2 2 0 00-.586-1.414l-4.828-4.828A2 2 0 0010.586 2H4zm6 6a1 1 0 10-2 0v4a1 1 0 102 0V8z" clipRule="evenodd" /></svg>,
    sparkles: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 2.5a.75.75 0 01.75.75v.518a2.5 2.5 0 011.64 2.228l.248.012a.75.75 0 01.732.968l-.343 1.03a2.5 2.5 0 01-2.228 1.64l-.012.248a.75.75 0 01-.968.732l-1.03-.343a2.5 2.5 0 01-1.64-2.228l-.248-.012a.75.75 0 01-.732-.968l.343-1.03A2.5 2.5 0 017.482 5.5l.012-.248A2.5 2.5 0 019.72 3.032V3.25a.75.75 0 01.75-.75zM10 5.25a.75.75 0 01.75.75v.008a.75.75 0 01-.75.75h-.008a.75.75 0 01-.75-.75V6a.75.75 0 01.75-.75zM5 10a.75.75 0 01.75.75v.008a.75.75 0 01-.75.75h-.008a.75.75 0 01-.75-.75V10.75A.75.75 0 015 10zm10 0a.75.75 0 01.75.75v.008a.75.75 0 01-.75.75h-.008a.75.75 0 01-.75-.75V10.75a.75.75 0 01.75-.75zM7.158 14.35a.75.75 0 01.292.65v.008a.75.75 0 01-1.492.142l-.006-.007a.75.75 0 01.142-1.492l.007-.006a.75.75 0 011.057.705zM12.842 14.35a.75.75 0 011.057-.705l.007.006a.75.75 0 01.142 1.492l-.006.007a.75.75 0 01-1.492-.142v-.008a.75.75 0 01.292-.65z" clipRule="evenodd" /></svg>,
    chevronLeft: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" /></svg>,
    chevronRight: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" /></svg>,
    lockOpen: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2V7a5 5 0 00-5-5zm1 11a1 1 0 11-2 0v-3a1 1 0 112 0v3z" /><path d="M10 4a3 3 0 00-3 3v2h6V7a3 3 0 00-3-3z" /></svg>,
    lockClosed: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" /></svg>,
}

// --- DATA PERSISTENCE HOOK ---
function usePersistentState<T>(key: string, initialState: T): [T, React.Dispatch<React.SetStateAction<T>>] {
    const [state, setState] = useState<T>(() => {
        try {
            const storageValue = localStorage.getItem(key);
            if (!storageValue) return initialState;
            const parsed = JSON.parse(storageValue);
            // Handle date revival for calendar events
            if (key === 'app_calendarEvents' && Array.isArray(parsed)) {
                return parsed.map(event => ({ ...event, date: new Date(event.date) })) as T;
            }
            return parsed;
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
const studentNames = ["Alice Johnson", "Bob Williams", "Charlie Brown", "Diana Miller", "Ethan Davis", "Fiona Garcia", "George Rodriguez", "Hannah Wilson"];
const generateDemoData = () => {
    const users: User[] = [
        { id: 'creator-01', name: 'Creator', password: 'creator', role: 'creator', dept: 'System', status: 'active' },
        { id: 'admin-01', name: 'Admin', password: 'admin', role: 'admin', dept: 'System', status: 'active' },
        { id: 'principal-01', name: 'Principal', password: 'principal', role: 'principal', dept: 'Administration', status: 'active' },
        { id: 'student-pending', name: 'Penny Pending', password: 'password123', role: 'student', dept: 'CSE', year: 'I', status: 'pending_approval' },
        { id: 'faculty-pending', name: 'Frank Future', password: 'password123', role: 'faculty', dept: 'ECE', status: 'pending_approval' },
    ];

    const facultyNames = ["Dr. Smith", "Prof. Jones", "Dr. Williams"];
    facultyNames.forEach((name, i) => {
        users.push({ id: `faculty-0${i+1}`, name, password: 'password123', role: 'faculty', dept: DEPARTMENTS[i % 3], status: 'active' });
    });

    studentNames.forEach((name, i) => {
        users.push({ id: `student-0${i+1}`, name, password: 'password123', role: 'student', dept: DEPARTMENTS[i % 2], year: YEARS[i % 4], status: 'active', attendance: { present: Math.floor(Math.random() * 20) + 70, total: 100 }, grades: [{ subject: 'Intro to AI', score: Math.floor(Math.random() * 30) + 65 }] });
    });

    const timetable: TimetableEntry[] = [
        { id: uuidv4(), department: 'CSE', year: 'II', day: 'Monday', timeIndex: 0, subject: 'Data Structures', type: 'class', faculty: 'Dr. Smith', room: 'CS-101' },
        { id: uuidv4(), department: 'CSE', year: 'II', day: 'Monday', timeIndex: 1, subject: 'Algorithms', type: 'class', faculty: 'Dr. Smith', room: 'CS-102' },
        { id: uuidv4(), department: 'ECE', year: 'III', day: 'Tuesday', timeIndex: 3, subject: 'Microprocessors', type: 'class', faculty: 'Prof. Jones', room: 'EC-201' },
        { id: uuidv4(), department: 'CSE', year: 'II', day: 'Monday', timeIndex: 2, subject: 'Break', type: 'break' },
    ];

    const announcements: Announcement[] = [{ id: uuidv4(), title: "Welcome to the New Semester!", content: "We're excited to start a new academic year. Please check your timetables and report any discrepancies to the admin office.", author: "Admin", timestamp: Date.now() - 86400000, targetRole: 'all', targetDept: 'all', reactions: { '🎉': ['student-01', 'faculty-02'], '👍': ['student-02'] } }];
    
    const resources: Resource[] = [{ id: uuidv4(), name: "DSA Textbook", type: 'book', department: 'CSE', subject: 'Data Structures', uploaderId: 'admin-01', uploaderName: 'Admin', timestamp: Date.now() - 172800000, source: 'local' }];

    const auditLogs: AuditLogEntry[] = [{ id: uuidv4(), timestamp: Date.now() - 50000, userId: 'admin-01', userName: 'Admin', action: 'User Login', ip: '192.168.1.1', status: 'success' }, { id: uuidv4(), timestamp: Date.now() - 80000, userId: 'unknown', userName: 'unknown', action: 'Failed Login Attempt', ip: '203.0.113.5', status: 'failure', details: 'Invalid credentials for user: hacker' }];
    
    const securityAlerts: SecurityAlert[] = [{ id: uuidv4(), type: 'Anomaly', title: 'Multiple Failed Logins', description: 'Detected 5 failed login attempts for user "Admin" from IP 203.0.113.5.', timestamp: Date.now() - 75000, severity: 'high', relatedUserId: 'admin-01', isResolved: false, responsePlan: { containment: "Temporarily block IP address 203.0.113.5.", investigation: "Verify if the attempts were made by the legitimate user.", recovery: "If legitimate, assist user with password reset. If malicious, maintain block.", recommendedAction: 'MONITOR' } }];
    
    const settings: AppSettings = { timeSlots: TIME_SLOTS_DEFAULT, accentColor: '#3B82F6' };

    const onlineCourses: OnlineCourse[] = [
        { id: 'oc-1', title: 'AI for Everyone', platform: 'Coursera', url: 'https://www.coursera.org/learn/ai-for-everyone', description: 'A foundational course on artificial intelligence, its applications, and its impact on society.', tags: ['AI', 'Beginner'] },
        { id: 'oc-2', title: 'Introduction to Python Programming', platform: 'edX', url: 'https://www.edx.org/course/introduction-to-python-programming', description: 'Learn the fundamentals of Python, a versatile language used in web development, data science, and more.', tags: ['Programming', 'Python', 'Beginner'] },
    ];

    const courseFiles: CourseFile[] = [
        { id: 'cf-1', facultyId: 'faculty-01', facultyName: 'Dr. Smith', department: 'CSE', subject: 'Data Structures', semester: 'Fall 2024', files: [{ name: 'syllabus.pdf', type: 'syllabus'}, { name: 'notes_ch1.pdf', type: 'notes' }], status: 'approved', submittedAt: Date.now() - 259200000, aiReview: { status: 'complete', summary: 'The materials are comprehensive and well-structured.', suggestions: ['Consider adding more visual diagrams to explain complex topics like tree traversal.'], corrections: [{ original: 'A stack is a LIFO (Last-In, First-Out) data structure.', corrected: 'A stack is a LIFO (Last-In, First-Out) abstract data type that serves as a collection of elements.'}] } },
    ];
    
    const now = new Date();
    const calendarEvents: CalendarEvent[] = [
        { id: 'ce-1', date: new Date(now.getFullYear(), now.getMonth(), 15), title: 'Mid-term Exams Begin', type: 'exam' },
        { id: 'ce-2', date: new Date(now.getFullYear(), now.getMonth(), 28), title: 'Project Submission', type: 'deadline' },
        { id: 'ce-3', date: new Date(now.getFullYear(), now.getMonth(), 10), title: 'Guest Lecture on AI', type: 'event' },
        { id: 'ce-4', date: new Date(now.getFullYear(), now.getMonth() + 1, 1), title: 'Semester Break', type: 'holiday' },
    ];


    return { users, timetable, auditLogs, securityAlerts, settings, announcements, resources, onlineCourses, courseFiles, calendarEvents };
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
    announcements: Announcement[];
    resources: Resource[];
    onlineCourses: OnlineCourse[];
    courseFiles: CourseFile[];
    calendarEvents: CalendarEvent[];
    settings: AppSettings;
    chatMessages: ChatMessage[];
    isChatLoading: boolean;
    login: (username: string, pass: string) => boolean;
    logout: () => void;
    signup: (userData: Omit<User, 'id' | 'status'>) => { success: boolean, message: string };
    setCurrentView: (view: AppView) => void;
    toggleSidebar: () => void;
    setTheme: (theme: 'light' | 'dark') => void;
    addNotification: (message: string, type?: AppNotification['type']) => void;
    addAuditLog: (log: Omit<AuditLogEntry, 'id' | 'timestamp'>) => void;
    resolveSecurityAlert: (alertId: string) => void;
    toggleAnnouncementReaction: (announcementId: string, emoji: string) => void;
    addCloudResource: (file: { name: string; source: 'gdrive' | 'onedrive' }) => void;
    triggerCourseFileAiReview: (courseFileId: string) => Promise<void>;
    sendChatMessage: (message: string) => Promise<void>;
    approveUser: (userId: string) => void;
    rejectUser: (userId: string) => void;
    updateUser: (userId: string, newDetails: Partial<User>) => void;
    toggleUserLock: (userId: string) => void;
    updateSettings: (newSettings: Partial<AppSettings>) => void;
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
    const [announcements, setAnnouncements] = usePersistentState<Announcement[]>('app_announcements', []);
    const [resources, setResources] = usePersistentState<Resource[]>('app_resources', []);
    const [onlineCourses, setOnlineCourses] = usePersistentState<OnlineCourse[]>('app_onlineCourses', []);
    const [courseFiles, setCourseFiles] = usePersistentState<CourseFile[]>('app_courseFiles', []);
    const [calendarEvents, setCalendarEvents] = usePersistentState<CalendarEvent[]>('app_calendarEvents', []);
    const [settings, setSettings] = usePersistentState<AppSettings>('app_settings', { timeSlots: TIME_SLOTS_DEFAULT, accentColor: '#3B82F6' });
    
    // Chat State
    const [chatMessages, setChatMessages] = usePersistentState<ChatMessage[]>('app_chatMessages', []);
    const [isChatLoading, setIsChatLoading] = useState(false);
    const chatSessionRef = useRef<Chat | null>(null);

    // This effect ensures that demo data is seeded only once if localStorage is empty,
    // preventing created users from being wiped out on reload.
    useEffect(() => {
        try {
            const storedUsers = localStorage.getItem('app_users');
            // If there are no users stored, it's a fresh start.
            if (!storedUsers || JSON.parse(storedUsers).length === 0) {
                const demoData = generateDemoData();
                setUsers(demoData.users);
                setTimetableEntries(demoData.timetable);
                setAuditLogs(demoData.auditLogs);
                setSecurityAlerts(demoData.securityAlerts);
                setSettings(demoData.settings);
                setAnnouncements(demoData.announcements);
                setResources(demoData.resources);
                setOnlineCourses(demoData.onlineCourses);
                setCourseFiles(demoData.courseFiles);
                setCalendarEvents(demoData.calendarEvents);
            }
        } catch (error) {
            console.error("Failed to initialize app data:", error);
            // Handle potential JSON parsing errors by resetting data
            const demoData = generateDemoData();
            setUsers(demoData.users);
            setTimetableEntries(demoData.timetable);
            setAuditLogs(demoData.auditLogs);
            setSecurityAlerts(demoData.securityAlerts);
            setSettings(demoData.settings);
            setAnnouncements(demoData.announcements);
            setResources(demoData.resources);
            setOnlineCourses(demoData.onlineCourses);
            setCourseFiles(demoData.courseFiles);
            setCalendarEvents(demoData.calendarEvents);
        }
        setIsInitialized(true);
    }, []); // Empty dependency array ensures this runs only once on mount

    useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);
    
    useEffect(() => {
        document.documentElement.style.setProperty('--accent-primary', settings.accentColor);
        const accentColor = settings.accentColor || '#3B82F6';
        if (accentColor.startsWith('#')) {
             let r = parseInt(accentColor.slice(1, 3), 16), g = parseInt(accentColor.slice(3, 5), 16), b = parseInt(accentColor.slice(5, 7), 16);
             r = Math.min(255, r + 20); g = Math.min(255, g + 20); b = Math.min(255, b + 20);
             const hoverColor = `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
             document.documentElement.style.setProperty('--accent-primary-hover', hoverColor);
        }
    }, [settings.accentColor]);

    const addNotification = (message: string, type: AppNotification['type'] = 'info') => {
        const newNotif = { id: uuidv4(), message, type };
        setNotifications(prev => [...prev, newNotif]);
        setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== newNotif.id)), 5000);
    };

    const addAuditLog = useCallback((log: Omit<AuditLogEntry, 'id' | 'timestamp'>) => {
        setAuditLogs(prev => [{ ...log, id: uuidv4(), timestamp: Date.now() }, ...prev]);
    }, [setAuditLogs]);

    const login = (username: string, pass: string): boolean => {
        // Find user by name first to provide specific feedback
        const userByName = users.find(u => u.name.toLowerCase() === username.toLowerCase());
    
        if (!userByName || userByName.password !== pass) {
            addNotification("Invalid username or password.", 'error');
            addAuditLog({ userId: userByName?.id || 'unknown', userName: username, action: 'Failed Login Attempt', ip: 'local', status: 'failure', details: !userByName ? 'Username not found.' : 'Incorrect password.' });
            return false;
        }
    
        // Now we know username and password are correct. Check status.
        if (userByName.status === 'pending_approval') {
            addNotification("Your account is pending approval from an administrator.", 'warning');
            addAuditLog({ userId: userByName.id, userName: userByName.name, action: 'Login Attempt (Pending Account)', ip: 'local', status: 'failure' });
            return false;
        }
    
        if (userByName.status === 'rejected') {
            addNotification("Your account registration was rejected. Please contact an admin.", 'error');
            addAuditLog({ userId: userByName.id, userName: userByName.name, action: 'Login Attempt (Rejected Account)', ip: 'local', status: 'failure' });
            return false;
        }
    
        if (userByName.isLocked) {
            addNotification("Your account is locked. Please contact an administrator.", 'error');
            addAuditLog({ userId: userByName.id, userName: userByName.name, action: 'Login Attempt (Locked Account)', ip: 'local', status: 'failure' });
            return false;
        }

        if (userByName.status !== 'active') {
             addNotification("This account is currently inactive.", 'error');
             addAuditLog({ userId: userByName.id, userName: userByName.name, action: 'Login Attempt (Inactive Account)', ip: 'local', status: 'failure' });
             return false;
        }
    
        // All checks passed, user is active and not locked
        setCurrentUser(userByName);
        setCurrentView('dashboard');
        addNotification(`Welcome back, ${userByName.name}!`, 'success');
        addAuditLog({ userId: userByName.id, userName: userByName.name, action: 'User Login', ip: 'local', status: 'success' });
        return true;
    };
    
    const signup = (userData: Omit<User, 'id'|'status'>) => {
        const reservedNames = ['admin', 'principal', 'creator'];
        if (reservedNames.includes(userData.name.toLowerCase())) {
            return { success: false, message: `The username "${userData.name}" is reserved and cannot be registered.` };
        }
        if (users.find(u => u.name.toLowerCase() === userData.name.toLowerCase())) {
            return { success: false, message: "Username already exists." };
        }
        const newUser: User = { ...userData, id: uuidv4(), status: 'pending_approval' };
        setUsers(prev => [...prev, newUser]);
        addAuditLog({ userId: newUser.id, userName: newUser.name, action: 'User Signup (Pending)', ip: 'local', status: 'info' });
        return { success: true, message: "Account created! It will be active after administrator approval." };
    };

    const logout = () => {
        if (currentUser) addAuditLog({ userId: currentUser.id, userName: currentUser.name, action: 'User Logout', ip: 'local', status: 'info' });
        setCurrentUser(null);
        setCurrentView('auth');
    };

    const toggleSidebar = () => setSidebarOpen(!isSidebarOpen);
    
    const resolveSecurityAlert = (alertId: string) => {
        setSecurityAlerts(prev => prev.map(alert => alert.id === alertId ? { ...alert, isResolved: true } : alert));
        addNotification("Alert has been marked as resolved.", 'info');
        if(currentUser) addAuditLog({ userId: currentUser.id, userName: currentUser.name, action: `Resolved Security Alert ${alertId}`, ip: 'local', status: 'info' });
    };

    const toggleAnnouncementReaction = (announcementId: string, emoji: string) => {
        if (!currentUser) return;
        setAnnouncements(prev => prev.map(ann => {
            if (ann.id === announcementId) {
                const newReactions = { ...(ann.reactions || {}) };
                if (!newReactions[emoji]) newReactions[emoji] = [];
                const userIndex = newReactions[emoji].indexOf(currentUser.id);
                userIndex > -1 ? newReactions[emoji].splice(userIndex, 1) : newReactions[emoji].push(currentUser.id);
                return { ...ann, reactions: newReactions };
            }
            return ann;
        }));
    };
    
    const addCloudResource = (file: { name: string; source: 'gdrive' | 'onedrive' }) => {
        if (!currentUser) return;
        const newResource: Resource = {
            id: uuidv4(), name: file.name, source: file.source, type: 'notes', department: currentUser.dept, subject: 'General',
            uploaderId: currentUser.id, uploaderName: currentUser.name, timestamp: Date.now(),
        };
        setResources(prev => [newResource, ...prev]);
        addNotification(`Added "${file.name}" from cloud.`, 'success');
    };

    const triggerCourseFileAiReview = async (courseFileId: string) => {
        if (!ai) {
            addNotification("AI features are disabled.", 'warning');
            return;
        }

        const courseFile = courseFiles.find(cf => cf.id === courseFileId);
        if (!courseFile) return;

        setCourseFiles(prev => prev.map(cf => cf.id === courseFileId ? { ...cf, aiReview: { ...cf.aiReview, status: 'pending' } } : cf));

        try {
            const prompt = `As an expert academic reviewer, analyze the following course file content for a "${courseFile.subject}" course. Provide a brief summary, 3-5 actionable suggestions for improvement, and identify one specific passage from the notes that could be improved, providing both original and corrected versions.
            
            Simulated Content:
            - Syllabus covers standard topics for this subject.
            - Lecture notes excerpt: "A stack is a LIFO data structure. You push things on and pop them off."
            - Sample quiz has 5 multiple-choice questions on basic concepts.

            Respond ONLY with a JSON object with keys: "summary", "suggestions" (an array of strings), and "corrections" (an array of objects with "original" and "corrected" string properties).`;

            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: { responseMimeType: "application/json" }
            });

            const result = JSON.parse(response.text);
            setCourseFiles(prev => prev.map(cf => cf.id === courseFileId ? { ...cf, aiReview: { ...result, status: 'complete' } } : cf));
            addNotification("AI review complete.", 'success');

        } catch (error) {
            console.error("AI Review Error:", error);
            addNotification("AI review failed.", 'error');
            setCourseFiles(prev => prev.map(cf => cf.id === courseFileId ? { ...cf, aiReview: { ...cf.aiReview, status: 'failed', summary: 'Error during analysis.', suggestions: [] } } : cf));
        }
    };
    
    const sendChatMessage = async (message: string) => {
        if (!ai) {
            addNotification("AI features are disabled.", 'warning');
            return;
        }
        const userMessage: ChatMessage = { id: uuidv4(), role: 'user', text: message };
        setChatMessages(prev => [...prev, userMessage]);
        setIsChatLoading(true);

        try {
            if (!chatSessionRef.current) {
                chatSessionRef.current = ai.chats.create({
                    model: 'gemini-2.5-flash',
                    config: { systemInstruction: "You are AcademiaAI, a helpful and friendly assistant for a college management portal. Answer concisely." }
                });
            }
            const response = await chatSessionRef.current.sendMessage({ message });
            const modelMessage: ChatMessage = { id: uuidv4(), role: 'model', text: response.text };
            setChatMessages(prev => [...prev, modelMessage]);
        } catch (error) {
            console.error("Chat Error:", error);
            const errorMessage: ChatMessage = { id: uuidv4(), role: 'model', text: "Sorry, I couldn't process that. Please try again.", isError: true };
            setChatMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsChatLoading(false);
        }
    };

    const approveUser = (userId: string) => {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, status: 'active' } : u));
        addNotification("User approved.", 'success');
    };

    const rejectUser = (userId: string) => {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, status: 'rejected' } : u));
        addNotification("User rejected.", 'info');
    };

    const updateUser = (userId: string, newDetails: Partial<User>) => {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...newDetails } : u));
        addNotification("User details updated.", 'success');
    };

    const toggleUserLock = (userId: string) => {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, isLocked: !u.isLocked } : u));
        addNotification("User lock status changed.", 'info');
    };
    
    const updateSettings = (newSettings: Partial<AppSettings>) => {
        setSettings(prev => ({...prev, ...newSettings}));
        addNotification("Settings updated successfully.", "success");
    };

    if (!isInitialized) {
        return <div className="loading-fullscreen"><div className="spinner"></div></div>;
    }

    const value = {
        currentUser, currentView, isSidebarOpen, theme, users, timetableEntries, auditLogs, securityAlerts, announcements, resources, onlineCourses, courseFiles, calendarEvents, settings, chatMessages, isChatLoading,
        login, logout, signup, setCurrentView, toggleSidebar, setTheme, addNotification, addAuditLog, resolveSecurityAlert,
        toggleAnnouncementReaction, addCloudResource, triggerCourseFileAiReview, sendChatMessage,
        approveUser, rejectUser, updateUser, toggleUserLock, updateSettings,
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
    if (!context) throw new Error('useAppContext must be used within an AppProvider');
    return context;
};

// --- COMPONENTS ---

const NotificationPortal = ({ notifications, removeNotification }: { notifications: AppNotification[], removeNotification: (id: string) => void }) => createPortal(
    <div className="notification-container">
        {notifications.map(notification => (
            <div key={notification.id} className={`notification-item ${notification.type}`}>
                <span>{notification.message}</span>
                <button className="notification-dismiss" onClick={() => removeNotification(notification.id)}>&times;</button>
            </div>
        ))}
    </div>, document.body
);

const Modal = ({ isOpen, onClose, title, children, size = 'md' }: { isOpen: boolean, onClose: () => void, title: string, children: React.ReactNode, size?: 'md' | 'lg' | 'xl' }) => {
    if (!isOpen) return null;
    return createPortal(
        <div className={`modal-overlay ${isOpen ? 'open' : ''}`} onMouseDown={onClose}>
            <div className={`modal-content modal-${size}`} onMouseDown={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>{title}</h3>
                    <button className="close-modal-btn" onClick={onClose}>{Icons.close}</button>
                </div>
                <div className="modal-body">{children}</div>
            </div>
        </div>, document.body
    );
};

const FloatingWindow = ({ isOpen, onClose, title, children, initialPosition = {x: 100, y: 100}, initialSize = {w: 500, h: 400} }: { isOpen: boolean, onClose: () => void, title: string, children: React.ReactNode, initialPosition?: {x: number, y: number}, initialSize?: {w: number, h: number} }) => {
    if (!isOpen) return null;

    const [position, setPosition] = useState({ x: initialPosition.x, y: initialPosition.y });
    const [size, setSize] = useState({ w: initialSize.w, h: initialSize.h });
    const [isDragging, setIsDragging] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const dragStartRef = useRef({ startX: 0, startY: 0, elemX: 0, elemY: 0 });
    const resizeStartRef = useRef({ startX: 0, startY: 0, startW: 0, startH: 0 });

    const handleDragMouseDown = (e: React.MouseEvent) => { setIsDragging(true); dragStartRef.current = { startX: e.clientX, startY: e.clientY, elemX: position.x, elemY: position.y }; e.preventDefault(); };
    const handleResizeMouseDown = (e: React.MouseEvent) => { setIsResizing(true); resizeStartRef.current = { startX: e.clientX, startY: e.clientY, startW: size.w, startH: size.h }; e.preventDefault(); };

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (isDragging) setPosition({ x: dragStartRef.current.elemX + e.clientX - dragStartRef.current.startX, y: dragStartRef.current.elemY + e.clientY - dragStartRef.current.startY });
        if (isResizing) setSize({ w: Math.max(300, resizeStartRef.current.startW + e.clientX - resizeStartRef.current.startX), h: Math.max(200, resizeStartRef.current.startH + e.clientY - resizeStartRef.current.startY) });
    }, [isDragging, isResizing]);

    const handleMouseUp = useCallback(() => { setIsDragging(false); setIsResizing(false); }, []);

    useEffect(() => {
        if (isDragging || isResizing) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, isResizing, handleMouseMove, handleMouseUp]);

    return createPortal(
        <div className="floating-window" style={{ left: `${position.x}px`, top: `${position.y}px`, width: `${size.w}px`, height: `${size.h}px` }}>
            <div className="floating-window-header" onMouseDown={handleDragMouseDown}>
                <h3>{title}</h3>
                <button className="close-modal-btn" onClick={onClose}>{Icons.close}</button>
            </div>
            <div className="floating-window-content">{children}</div>
            <div className="resize-handle" onMouseDown={handleResizeMouseDown}></div>
        </div>, document.body
    );
};

const DraggableBubble = ({ children, onClick, initialPosition = { right: 32, bottom: 32 } }: { children: React.ReactNode, onClick: () => void, initialPosition?: {right: number, bottom: number} }) => {
    const [position, setPosition] = useState(initialPosition);
    const [isDragging, setIsDragging] = useState(false);
    const dragStartRef = useRef({ startX: 0, startY: 0, startRight: 0, startBottom: 0 });
    const hasDragged = useRef(false);

    const handleMouseDown = (e: React.MouseEvent) => { e.preventDefault(); setIsDragging(true); hasDragged.current = false; dragStartRef.current = { startX: e.clientX, startY: e.clientY, startRight: position.right, startBottom: position.bottom, }; };
    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isDragging) return;
        const dx = e.clientX - dragStartRef.current.startX; const dy = e.clientY - dragStartRef.current.startY;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) hasDragged.current = true;
        setPosition({ right: dragStartRef.current.startRight - dx, bottom: dragStartRef.current.startBottom - dy });
    }, [isDragging]);
    const handleMouseUp = () => { setIsDragging(false); if (!hasDragged.current) onClick(); };

    useEffect(() => {
        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, handleMouseMove]);
    
    return <div className={`chatbot-fab ${isDragging ? 'dragging' : ''}`} style={{ right: `${position.right}px`, bottom: `${position.bottom}px` }} onMouseDown={handleMouseDown}>{children}</div>;
};

const ChatbotWindow = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
    const { chatMessages, sendChatMessage, isChatLoading } = useAppContext();
    const [input, setInput] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isOpen) {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
    }, [chatMessages, isOpen]);

    const handleSend = (e: React.FormEvent) => {
        e.preventDefault();
        if (input.trim() && !isChatLoading) {
            sendChatMessage(input);
            setInput('');
        }
    };

    if (!isOpen) return null;

    return createPortal(
        <div className="chatbot-window">
            <div className="chatbot-header">
                <h3>AI Assistant</h3>
                <button onClick={onClose}>{Icons.close}</button>
            </div>
            <div className="chatbot-messages">
                 {chatMessages.length === 0 && <div className="chat-empty-state">Ask me anything!</div>}
                {chatMessages.map(msg => (
                    <div key={msg.id} className={`chat-message ${msg.role} ${msg.isError ? 'error' : ''}`}>
                        <div className="chat-bubble" dangerouslySetInnerHTML={{ __html: msg.role === 'model' ? marked.parse(msg.text) : msg.text.replace(/</g, "&lt;").replace(/>/g, "&gt;") }}></div>
                    </div>
                ))}
                {isChatLoading && (
                    <div className="chat-message model">
                        <div className="chat-bubble loading-dots"><span></span><span></span><span></span></div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>
            <form className="chatbot-input-form" onSubmit={handleSend}>
                <input
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder="Ask me anything..."
                    disabled={isChatLoading}
                    aria-label="Chat input"
                />
                <button type="submit" disabled={isChatLoading || !input.trim()} aria-label="Send message">{Icons.send}</button>
            </form>
        </div>,
        document.body
    );
};


const Sidebar = () => {
    const { currentUser, currentView, setCurrentView, logout, isSidebarOpen, toggleSidebar } = useAppContext();
    const visibleViews = Object.entries(APP_VIEWS_CONFIG).filter(([, config]) => currentUser && config.roles.includes(currentUser.role));

    return (
        <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
            <div className="sidebar-header">
                <span className="logo">{Icons.logo}</span>
                <h1>AcademiaAI</h1>
                <button className="sidebar-close" onClick={toggleSidebar}>{Icons.close}</button>
            </div>
            <nav className="nav-list">
                <ul>
                    {visibleViews.map(([viewKey, config]) => (
                        <li className="nav-item" key={viewKey}>
                            <button className={currentView === viewKey ? 'active' : ''} onClick={() => { setCurrentView(viewKey as AppView); if (isSidebarOpen) toggleSidebar(); }}>
                                {Icons[config.icon]}
                                <span>{config.title}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            </nav>
            <div className="sidebar-footer">
                <button className="nav-item" onClick={logout}>{Icons.logout}<span>Logout</span></button>
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
    const { login, signup, addNotification } = useAppContext();
    const [isLoginView, setIsLoginView] = useState(true);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [role, setRole] = useState<UserRole>('student');
    const [dept, setDept] = useState(DEPARTMENTS[0]);
    const [year, setYear] = useState(YEARS[0]);
    const [isAiHelpOpen, setAiHelpOpen] = useState(false);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (isLoginView) {
            login(username, password);
        } else {
            if (password.length < 6) { addNotification("Password must be at least 6 characters.", 'error'); return; }
            if (password !== confirmPassword) { addNotification("Passwords do not match.", 'error'); return; }
            const signupData: Omit<User, 'id' | 'status'> = { name: username, password, role, dept: (role === 'admin' || role === 'principal') ? 'Administration' : dept, year: role === 'student' ? year : undefined, };
            const { success, message } = signup(signupData);
            if (success) { addNotification(message, 'success'); setIsLoginView(true); setPassword(''); setConfirmPassword(''); } 
            else { addNotification(message, 'error'); }
        }
    };

    return (
        <div className="login-view-container">
            <div className="login-card">
                <div className={`login-card-inner ${!isLoginView ? 'is-flipped' : ''}`}>
                    {/* Login Form */}
                    <div className="login-card-front">
                        <div className="login-header"> <span className="logo">{Icons.logo}</span> <h1>Welcome Back</h1> </div>
                        <form onSubmit={handleSubmit}>
                            <div className="control-group"> <label htmlFor="login-username">Username</label> <input type="text" id="login-username" className="form-control" value={username} onChange={e => setUsername(e.target.value)} required /> </div>
                            <div className="control-group"> <label htmlFor="login-password">Password</label> <input type="password" id="login-password" className="form-control" value={password} onChange={e => setPassword(e.target.value)} required /> </div>
                            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }}> Sign In </button>
                        </form>
                        <div className="auth-toggle"> Don't have an account? <button onClick={() => setIsLoginView(false)}>Sign Up</button> </div>
                    </div>
                    {/* Sign Up Form */}
                    <div className="login-card-back">
                        <div className="login-header"> <span className="logo">{Icons.logo}</span> <h1>Create Account</h1> </div>
                        <form onSubmit={handleSubmit}>
                            <div className="control-group"> <label htmlFor="signup-username">Username</label> <input type="text" id="signup-username" className="form-control" value={username} onChange={e => setUsername(e.target.value)} required /> </div>
                            <div className="control-group"> <label htmlFor="signup-password">Password</label> <input type="password" id="signup-password" className="form-control" value={password} onChange={e => setPassword(e.target.value)} required /> </div>
                            <div className="control-group"> <label htmlFor="confirmPassword">Confirm Password</label> <input type="password" id="confirmPassword" className="form-control" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required /> </div>
                            <div className="form-grid">
                                <div className="control-group"> <label htmlFor="role">Role</label> <select id="role" className="form-control" value={role} onChange={e => setRole(e.target.value as UserRole)}> <option value="student">Student</option> <option value="faculty">Faculty</option> <option value="hod">HOD</option> <option value="class advisor">Class Advisor</option> <option value="admin">Admin</option> <option value="principal">Principal</option> </select> </div>
                                {(role !== 'admin' && role !== 'principal') && (<div className="control-group"> <label htmlFor="dept">Department</label> <select id="dept" className="form-control" value={dept} onChange={e => setDept(e.target.value)}> {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)} </select> </div>)}
                            </div>
                            {role === 'student' && (<div className="control-group"> <label htmlFor="year">Year</label> <select id="year" className="form-control" value={year} onChange={e => setYear(e.target.value)}> {YEARS.map(y => <option key={y} value={y}>{y}</option>)} </select> </div>)}
                            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }}> Sign Up </button>
                        </form>
                        <div className="auth-toggle"> Already have an account? <button onClick={() => setIsLoginView(true)}>Sign In</button> </div>
                    </div>
                </div>
            </div>
             <button className="ai-help-fab" onClick={() => setAiHelpOpen(true)}>{Icons.sparkles}</button>
             <Modal isOpen={isAiHelpOpen} onClose={() => setAiHelpOpen(false)} title="AI Sign-Up Assistant">
                <div className="ai-assistant-content">
                    <h4>Hello! How can I help you?</h4>
                    <p>Here are some common questions:</p>
                    <ul>
                        <li><b>What is the 'HOD' role?</b><br />HOD stands for Head of Department. They manage a specific academic department.</li>
                        <li><b>What is the 'Principal' role?</b><br />The Principal oversees the entire institution, with access to high-level summaries and management tools.</li>
                        <li><b>Can you suggest a strong password?</b><br />Certainly! How about: `Tr@vel!ngD#sk88`</li>
                    </ul>
                </div>
            </Modal>
        </div>
    );
};

const DashboardView = () => {
    const { currentUser, users, courseFiles, securityAlerts, announcements } = useAppContext();

    if (currentUser?.role === 'creator') {
        const pendingApprovals = users.filter(u => u.status === 'pending_approval').length;
        const unresolvedAlerts = securityAlerts.filter(a => !a.isResolved).length;
        return (
            <div className="dashboard-container">
                <h2 className="dashboard-greeting">Creator Control Panel</h2>
                <div className="principal-stats-grid">
                    <div className="dashboard-card stat-card"><h3>Total Users</h3><p>{users.length}</p></div>
                    <div className="dashboard-card stat-card"><h3>Pending Approvals</h3><p>{pendingApprovals}</p></div>
                    <div className="dashboard-card stat-card"><h3>Active Alerts</h3><p>{unresolvedAlerts}</p></div>
                    <div className="dashboard-card stat-card"><h3>Announcements</h3><p>{announcements.length}</p></div>
                </div>
                 <div className="dashboard-card">
                    <h3>System Status Overview</h3>
                    <p>All systems are operational. You have full access to all management modules via the sidebar.</p>
                </div>
            </div>
        )
    }

    if (currentUser?.role === 'principal') {
        return (
            <div className="dashboard-container">
                <h2 className="dashboard-greeting">Welcome, Principal {currentUser?.name}!</h2>
                <div className="principal-stats-grid">
                    <div className="dashboard-card stat-card"><h3>Total Users</h3><p>{users.length}</p></div>
                    <div className="dashboard-card stat-card"><h3>Students</h3><p>{users.filter(u=>u.role==='student').length}</p></div>
                    <div className="dashboard-card stat-card"><h3>Faculty</h3><p>{users.filter(u=>u.role==='faculty').length}</p></div>
                    <div className="dashboard-card stat-card"><h3>Pending Course Files</h3><p>{courseFiles.filter(cf=>cf.status==='pending_review').length}</p></div>
                </div>
                 <div className="dashboard-card">
                    <h3>Recent Activity</h3>
                    <p>A summary of recent announcements and submissions will be shown here.</p>
                </div>
            </div>
        )
    }

    return (
        <div className="dashboard-container">
            <h2 className="dashboard-greeting">Welcome, {currentUser?.name}!</h2>
            <div className="dashboard-card"> <h3>Today's Schedule</h3> <p>You have 4 classes and 1 meeting today.</p> </div>
            <div className="dashboard-card"> <h3>Activity Feed</h3>
                <div className="feed-list">
                    <div className="feed-item-card class stagger-item" style={{ animationDelay: '100ms' }}> <div className="feed-item-icon">{Icons.timetable}</div> <div> <p className="feed-item-title">Next Class: Data Structures</p> <p className="feed-item-meta">10:50 AM in CS-101 with Dr. Smith</p> </div> </div>
                    <div className="feed-item-card announcement stagger-item" style={{ animationDelay: '200ms' }}> <div className="feed-item-icon">{Icons.announcement}</div> <div> <p className="feed-item-title">New Announcement: Symposium '24</p> <p className="feed-item-meta">Posted by HOD (CSE) - 2 hours ago</p> </div> </div>
                </div>
            </div>
        </div>
    );
};

const TimetableView = () => {
    const { currentUser, timetableEntries, settings } = useAppContext();
    const [department, setDepartment] = useState(currentUser?.dept || DEPARTMENTS[0]);
    const [year, setYear] = useState(currentUser?.role === 'student' ? currentUser.year || YEARS[0] : YEARS[0]);

    const grid = useMemo(() => {
        const filteredEntries = timetableEntries.filter(e => e.department === department && e.year === year);
        const newGrid: (TimetableEntry | null)[][] = Array(settings.timeSlots.length).fill(0).map(() => Array(5).fill(null));
        filteredEntries.forEach(entry => {
            const dayIndex = DAYS.indexOf(entry.day);
            if (dayIndex >= 0 && dayIndex < 5 && entry.timeIndex >= 0 && entry.timeIndex < settings.timeSlots.length) {
                newGrid[entry.timeIndex][dayIndex] = entry;
            }
        });
        return newGrid;
    }, [timetableEntries, department, year, settings.timeSlots]);

    return (
        <div className="timetable-container">
            <div className="timetable-header">
                <h3>Class Timetable</h3>
                <div className="timetable-controls">
                    <select className="form-control" value={department} onChange={e => setDepartment(e.target.value)}>{DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}</select>
                    <select className="form-control" value={year} onChange={e => setYear(e.target.value)}>{YEARS.map(y => <option key={y} value={y}>{y}</option>)}</select>
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
                                    {entry && (<> <span className="subject">{entry.subject}</span> {entry.faculty && <span className="faculty">{entry.faculty}</span>} </>)}
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
    const { timetableEntries, settings } = useAppContext();
    return (
        <div className="manage-timetable-container">
            <div className="dashboard-card"> <h3>Add/Edit Timetable Entry</h3> {/* Form would go here */} </div>
            <div className="dashboard-card"> <h3>Current Entries</h3>
                <div className="table-wrapper">
                    <table className="entry-list-table">
                        <thead> <tr> <th>Dept</th> <th>Year</th> <th>Day</th> <th>Time</th> <th>Subject</th> <th>Faculty</th> <th>Actions</th> </tr> </thead>
                        <tbody>
                            {timetableEntries.map(entry => (
                                <tr key={entry.id}>
                                    <td data-label="Dept">{entry.department}</td> <td data-label="Year">{entry.year}</td> <td data-label="Day">{entry.day}</td>
                                    <td data-label="Time">{settings.timeSlots[entry.timeIndex]}</td> <td data-label="Subject">{entry.subject}</td>
                                    <td data-label="Faculty">{entry.faculty || '-'}</td>
                                    <td data-label="Actions"> <div className="entry-actions"> <button>{Icons.editPencil}</button> <button className="delete-btn">{Icons.delete}</button> </div> </td>
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
    const { users } = useAppContext();
    const [searchQuery, setSearchQuery] = useState('');
    const [filters, setFilters] = useState({ department: 'all', year: 'all' });
    const [selectedStudent, setSelectedStudent] = useState<User | null>(null);

    const filteredStudents = useMemo(() => {
        return users.filter(student => student.role === 'student' &&
            (filters.department === 'all' || student.dept === filters.department) &&
            (filters.year === 'all' || student.year === filters.year) &&
            student.name.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [users, filters, searchQuery]);
    
    return (
        <div className="directory-container">
            <div className="directory-header">
                <div className="search-bar" style={{ flexGrow: 1 }}> {Icons.search} <input type="text" className="form-control" placeholder="Search by name..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} /> </div>
                <div className="directory-controls">
                    <select className="form-control" value={filters.department} onChange={e => setFilters(f => ({...f, department: e.target.value}))}> <option value="all">All Departments</option> {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)} </select>
                    <select className="form-control" value={filters.year} onChange={e => setFilters(f => ({...f, year: e.target.value}))}> <option value="all">All Years</option> {YEARS.map(y => <option key={y} value={y}>{y}</option>)} </select>
                </div>
            </div>
            <div className="student-grid">
                {filteredStudents.map((student, index) => (
                    <div className="student-card stagger-item" key={student.id} onClick={() => setSelectedStudent(student)} style={{ animationDelay: `${index * 50}ms` }}>
                        <div className="student-card-avatar">{student.name.charAt(0)}</div>
                        <div className="student-card-info">
                            <h4>{student.name}</h4> <p>{student.dept} - Year {student.year}</p>
                            {student.attendance && ( <div className="attendance-bar-container"> <div className={`attendance-bar ${student.attendance.present / student.attendance.total > 0.9 ? 'good' : student.attendance.present / student.attendance.total > 0.75 ? 'fair' : 'poor'}`} style={{ width: `${(student.attendance.present / student.attendance.total) * 100}%` }} title={`Attendance: ${student.attendance.present}%`}></div> </div> )}
                        </div>
                    </div>
                ))}
            </div>
            {selectedStudent && (
                 <FloatingWindow isOpen={!!selectedStudent} onClose={() => setSelectedStudent(null)} title={`Student Details: ${selectedStudent.name}`} initialSize={{ w: 600, h: 500 }}>
                    <div className="student-details-content">
                         <div className="student-details-section"> <h5>Details</h5> <p><strong>Department:</strong> {selectedStudent.dept}</p> <p><strong>Year:</strong> {selectedStudent.year}</p> </div>
                         <div className="student-details-section"> <h5>Performance</h5> <p><strong>Attendance:</strong> {selectedStudent.attendance?.present || 'N/A'}%</p> <p><strong>Latest Grade:</strong> {selectedStudent.grades?.[0]?.subject} - {selectedStudent.grades?.[0]?.score || 'N/A'}</p> </div>
                    </div>
                </FloatingWindow>
            )}
        </div>
    );
};

const SecurityView = () => {
    const { auditLogs, securityAlerts, resolveSecurityAlert } = useAppContext();
    const unresolvedAlerts = securityAlerts.filter(a => !a.isResolved);
    return (
        <div className="security-center-container">
            <div className="dashboard-card"><h3>Active Security Alerts</h3>
                <ul className="alert-list">
                    {unresolvedAlerts.map((alert, index) => (
                        <li key={alert.id} className={`alert-item severity-${alert.severity} stagger-item`} style={{ animationDelay: `${index * 50}ms` }}>
                           <div className="alert-item-header"> <span className="alert-title"><strong>{alert.title}</strong></span> <span className="alert-meta">{getRelativeTime(alert.timestamp)}</span> </div>
                           <p className="alert-description">{alert.description}</p>
                            <div className="alert-item-actions"> <button className="btn btn-sm btn-success" onClick={(e) => { e.stopPropagation(); resolveSecurityAlert(alert.id); }}>Mark as Resolved</button> </div>
                        </li>
                    ))}
                    {unresolvedAlerts.length === 0 && <p>No active alerts.</p>}
                </ul>
            </div>
            <div className="dashboard-card"><h3>Audit Log</h3>
                <div className="table-wrapper">
                    <table className="entry-list-table">
                        <thead> <tr> <th>Timestamp</th> <th>User</th> <th>Action</th> <th>Status</th> <th>IP Address</th> </tr> </thead>
                        <tbody> {auditLogs.map((log, index) => ( <tr key={log.id} className="stagger-item" style={{ animationDelay: `${index * 30}ms` }}> <td data-label="Timestamp">{new Date(log.timestamp).toLocaleString()}</td> <td data-label="User">{log.userName}</td> <td data-label="Action">{log.action}</td> <td data-label="Status"><span className={`status-pill ${log.status}`}>{log.status}</span></td> <td data-label="IP">{log.ip}</td> </tr> ))} </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

const AnnouncementCard = ({ announcement }: { announcement: Announcement }) => {
    const { currentUser, toggleAnnouncementReaction } = useAppContext();
    const [pickerOpen, setPickerOpen] = useState(false);
    const pickerRef = useRef<HTMLDivElement>(null);

    const handleReaction = (emoji: string) => { toggleAnnouncementReaction(announcement.id, emoji); setPickerOpen(false); };

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => { if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) setPickerOpen(false); };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [pickerRef]);

    return (
        <div className="announcement-card stagger-item">
            <div className="announcement-item-header"><h3>{announcement.title}</h3><div className="announcement-item-meta"><span>{announcement.author}</span><span>{getRelativeTime(announcement.timestamp)}</span></div></div>
            <div className="announcement-item-targets"><span className="target-pill">{announcement.targetDept}</span><span className="target-pill">{announcement.targetRole}</span></div>
            <p className="announcement-item-content">{announcement.content}</p>
            <div className="announcement-footer">
                 <div className="announcement-reactions">{Object.entries(announcement.reactions || {}).map(([emoji, userIds]) => userIds.length > 0 && ( <span key={emoji} className={`reaction-pill ${userIds.includes(currentUser?.id || '') ? 'me' : ''}`}> {emoji} {userIds.length} </span> ))}</div>
                <div className="reaction-container" ref={pickerRef}>
                    <button className="btn btn-sm btn-secondary" onClick={() => setPickerOpen(p => !p)}>{Icons.react}</button>
                    {pickerOpen && ( <div className="reaction-picker"> {['👍', '❤️', '🎉', '🤔'].map(emoji => ( <button key={emoji} onClick={() => handleReaction(emoji)}>{emoji}</button> ))} </div> )}
                </div>
            </div>
        </div>
    );
};

const AnnouncementsView = () => {
    const { announcements } = useAppContext();
    return (
        <div className="announcements-view-container">
            <div className="announcements-header"> <h3>Latest Announcements</h3> <button className="btn btn-primary">{Icons.add} New Announcement</button> </div>
            <div className="announcement-list"> {announcements.sort((a,b) => b.timestamp - a.timestamp).map((ann) => ( <AnnouncementCard key={ann.id} announcement={ann} /> ))} </div>
        </div>
    );
};

const CloudFilePicker = ({ onClose }: { onClose: () => void }) => {
    const { addCloudResource } = useAppContext();
    const [activeTab, setActiveTab] = useState<'gdrive' | 'onedrive'>('gdrive');
    const fakeFiles = { gdrive: [{ id: 'g1', name: 'AI_Ethics_Lecture.pdf', type: 'file' }, { id: 'g2', name: 'Project_Submissions', type: 'folder' }], onedrive: [{ id: 'o1', name: 'Syllabus_Fall2024.docx', type: 'file' }, { id: 'o2', name: 'Lab_Manuals', type: 'folder' }] };
    const handleSelect = (name: string) => { addCloudResource({ name, source: activeTab }); onClose(); };

    return (
        <div className="cloud-picker-container">
            <div className="cloud-picker-tabs">
                <button className={activeTab === 'gdrive' ? 'active' : ''} onClick={() => setActiveTab('gdrive')}>{Icons.googleDrive} Google Drive</button>
                <button className={activeTab === 'onedrive' ? 'active' : ''} onClick={() => setActiveTab('onedrive')}>{Icons.oneDrive} OneDrive</button>
            </div>
            <ul className="cloud-file-list">
                {fakeFiles[activeTab].map(file => (
                    <li key={file.id}> <div className="file-info">{file.type === 'folder' ? Icons.folder : Icons.file}<span>{file.name}</span></div> <button className="btn btn-sm btn-secondary" onClick={() => handleSelect(file.name)}>Select</button> </li>
                ))}
            </ul>
        </div>
    );
};

const ResourcesView = () => {
    const { resources, onlineCourses } = useAppContext();
    const [isCloudPickerOpen, setCloudPickerOpen] = useState(false);
    const [activeTab, setActiveTab] = useState('library');

    return (
        <div className="resources-container-view">
             <div className="resources-view-controls">
                <div className="tabs">
                    <button className={`tab-btn ${activeTab === 'library' ? 'active' : ''}`} onClick={() => setActiveTab('library')}>Library Files</button>
                    <button className={`tab-btn ${activeTab === 'courses' ? 'active' : ''}`} onClick={() => setActiveTab('courses')}>Online Courses</button>
                </div>
                {activeTab === 'library' && <button className="btn btn-primary" onClick={() => setCloudPickerOpen(true)}>{Icons.cloud} Add from Cloud</button>}
            </div>

            {activeTab === 'library' && (
                <div className="table-wrapper">
                    <table className="entry-list-table">
                        <thead><tr><th>Name</th><th>Source</th><th>Uploader</th><th>Date</th><th>Actions</th></tr></thead>
                        <tbody>
                            {resources.map(res => (
                                <tr key={res.id}>
                                    <td data-label="Name">{res.name}</td>
                                    <td data-label="Source"><span className="source-pill"> {res.source === 'gdrive' && Icons.googleDrive} {res.source === 'onedrive' && Icons.oneDrive} {res.source === 'local' && Icons.upload} {res.source || 'local'} </span></td>
                                    <td data-label="Uploader">{res.uploaderName}</td> <td data-label="Date">{new Date(res.timestamp).toLocaleDateString()}</td>
                                    <td data-label="Actions"><div className="entry-actions"><button>{Icons.download}</button></div></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {activeTab === 'courses' && (
                <div className="online-courses-grid">
                    {onlineCourses.map(course => (
                        <div key={course.id} className="course-card stagger-item">
                            <h4>{course.title}</h4>
                            <p className="platform">{course.platform}</p>
                            <p className="description">{course.description}</p>
                            <div className="tags">{course.tags.map(tag => <span key={tag} className="tag-pill">{tag}</span>)}</div>
                            <a href={course.url} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-primary">Go to Course</a>
                        </div>
                    ))}
                </div>
            )}

            <Modal isOpen={isCloudPickerOpen} onClose={() => setCloudPickerOpen(false)} title="Add from Cloud Storage" size="md">
                <CloudFilePicker onClose={() => setCloudPickerOpen(false)} />
            </Modal>
        </div>
    );
};

const CourseFilesView = () => {
    const { currentUser, courseFiles, triggerCourseFileAiReview } = useAppContext();
    const [selectedFile, setSelectedFile] = useState<CourseFile | null>(null);

    const relevantFiles = courseFiles.filter(cf => 
        currentUser?.role === 'faculty' ? cf.facultyId === currentUser.id :
        currentUser?.role === 'hod' || currentUser?.role === 'class advisor' ? cf.department === currentUser.dept :
        true // Admin, principal and creator see all
    );

    const handleReviewClick = (e: React.MouseEvent, file: CourseFile) => {
        e.stopPropagation();
        triggerCourseFileAiReview(file.id);
    }
    
    return (
        <div className="course-files-container">
            <div className="course-files-header">
                <h3>Course File Submissions</h3>
                {currentUser?.role === 'faculty' && <button className="btn btn-primary">{Icons.upload} Submit New File</button>}
            </div>
            <div className="table-wrapper">
                <table className="entry-list-table">
                    <thead><tr><th>Faculty</th><th>Subject</th><th>Semester</th><th>Submitted</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                        {relevantFiles.map(file => (
                            <tr key={file.id} onClick={() => setSelectedFile(file)} style={{cursor: 'pointer'}}>
                                <td data-label="Faculty">{file.facultyName}</td>
                                <td data-label="Subject">{file.subject}</td>
                                <td data-label="Semester">{file.semester}</td>
                                <td data-label="Submitted">{new Date(file.submittedAt).toLocaleDateString()}</td>
                                <td data-label="Status"><span className={`status-pill ${file.status}`}>{file.status.replace('_', ' ')}</span></td>
                                <td data-label="Actions"><div className="entry-actions"><button className="btn btn-sm btn-secondary" onClick={(e) => {e.stopPropagation(); setSelectedFile(file)}}>View</button></div></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <Modal isOpen={!!selectedFile} onClose={() => setSelectedFile(null)} title={`Review: ${selectedFile?.subject}`} size="lg">
                {selectedFile && (
                    <div className="course-file-details">
                        <h4>Files Submitted</h4>
                        <ul>{selectedFile.files.map(f => <li key={f.name}>{f.name} ({f.type})</li>)}</ul>
                        <hr />
                        <h4>AI-Powered Review</h4>
                        {selectedFile.aiReview?.status === 'pending' && <div className="spinner-container"><div className="spinner"></div><p>AI is analyzing the files...</p></div>}
                        {selectedFile.aiReview?.status === 'failed' && <p className="text-danger">AI analysis failed.</p>}
                        {selectedFile.aiReview?.status === 'complete' && (
                            <div className="ai-review-content">
                                <div className="ai-review-section"><h5>Summary</h5><p>{selectedFile.aiReview.summary}</p></div>
                                <div className="ai-review-section"><h5>Suggestions</h5><ul>{selectedFile.aiReview.suggestions?.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
                                {selectedFile.aiReview.corrections && (
                                     <div className="ai-review-section"><h5>Auto-Corrections</h5>
                                        {selectedFile.aiReview.corrections.map((c, i) =>(
                                            <div key={i} className="correction-box">
                                                <p><strong>Original:</strong> <span className="text-original">{c.original}</span></p>
                                                <p><strong>Corrected:</strong> <span className="text-corrected">{c.corrected}</span></p>
                                            </div>
                                        ))}
                                     </div>
                                )}
                            </div>
                        )}
                        {!selectedFile.aiReview && <p>No AI review has been performed yet.</p>}
                        <div className="form-actions">
                            <button className="btn btn-secondary" onClick={(e) => handleReviewClick(e, selectedFile)} disabled={selectedFile.aiReview?.status === 'pending'}>
                                {Icons.sparkles} {selectedFile.aiReview?.status === 'pending' ? 'Analyzing...' : 'Re-run AI Review'}
                            </button>
                            {(currentUser?.role === 'principal') && (
                                <>
                                <button className="btn btn-danger">Request Revision</button>
                                <button className="btn btn-success">Approve</button>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
};

const AcademicCalendarView = () => {
    const { calendarEvents } = useAppContext();
    const [currentDate, setCurrentDate] = useState(new Date());

    const changeMonth = (amount: number) => {
        setCurrentDate(prev => {
            const newDate = new Date(prev);
            newDate.setMonth(newDate.getMonth() + amount);
            return newDate;
        });
    };

    const calendarGrid = useMemo(() => {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        
        const grid: { day: number; isCurrentMonth: boolean; events: CalendarEvent[] }[] = [];
        const daysInPrevMonth = new Date(year, month, 0).getDate();

        // Previous month's days
        for (let i = (firstDay + 6) % 7; i > 0; i--) {
            grid.push({ day: daysInPrevMonth - i + 1, isCurrentMonth: false, events: [] });
        }
        // Current month's days
        for (let i = 1; i <= daysInMonth; i++) {
            const dayEvents = calendarEvents.filter(e => 
                e.date.getFullYear() === year && e.date.getMonth() === month && e.date.getDate() === i
            );
            grid.push({ day: i, isCurrentMonth: true, events: dayEvents });
        }
        // Next month's days
        const remaining = 42 - grid.length;
        for (let i = 1; i <= remaining; i++) {
            grid.push({ day: i, isCurrentMonth: false, events: [] });
        }
        return grid;
    }, [currentDate, calendarEvents]);
    
    return (
        <div className="calendar-view-container">
            <div className="calendar-header">
                <button onClick={() => changeMonth(-1)}>{Icons.chevronLeft}</button>
                <h2>{currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}</h2>
                <button onClick={() => changeMonth(1)}>{Icons.chevronRight}</button>
            </div>
            <div className="calendar-grid">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => <div key={day} className="calendar-day-header">{day}</div>)}
                {calendarGrid.map((cell, index) => (
                    <div key={index} className={`calendar-cell ${!cell.isCurrentMonth ? 'other-month' : ''}`}>
                        <div className="day-number">{cell.day}</div>
                        <div className="events">
                            {cell.events.map(event => (
                                <div key={event.id} className={`event-pill ${event.type}`}>{event.title}</div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

const ApprovalsView = () => {
    const { users, approveUser, rejectUser } = useAppContext();
    const pendingUsers = users.filter(u => u.status === 'pending_approval');

    return (
        <div className="approvals-container">
            <div className="dashboard-card">
                <h3>Pending User Approvals</h3>
                {pendingUsers.length === 0 ? <p>No users are currently awaiting approval.</p> : (
                    <div className="table-wrapper">
                        <table className="entry-list-table">
                            <thead><tr><th>Name</th><th>Role</th><th>Department</th><th>Actions</th></tr></thead>
                            <tbody>
                                {pendingUsers.map(user => (
                                    <tr key={user.id}>
                                        <td data-label="Name">{user.name}</td>
                                        <td data-label="Role">{user.role}</td>
                                        <td data-label="Department">{user.dept}</td>
                                        <td data-label="Actions">
                                            <div className="entry-actions">
                                                <button className="btn btn-sm btn-success" onClick={() => approveUser(user.id)}>{Icons.check} Approve</button>
                                                <button className="btn btn-sm btn-danger" onClick={() => rejectUser(user.id)}>{Icons.close} Reject</button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

const UserManagementView = () => {
    const { users, updateUser, toggleUserLock } = useAppContext();
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [search, setSearch] = useState('');

    const filteredUsers = users.filter(u => u.name.toLowerCase().includes(search.toLowerCase()));

    const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (editingUser) {
            updateUser(editingUser.id, editingUser);
            setEditingUser(null);
        }
    };
    
    return (
        <div className="user-management-container">
            <div className="dashboard-card">
                <h3>User Management</h3>
                <div className="search-bar" style={{margin: '1rem 0'}}> {Icons.search} <input type="text" className="form-control" placeholder="Search users..." value={search} onChange={e => setSearch(e.target.value)} /> </div>
                <div className="table-wrapper">
                    <table className="entry-list-table">
                        <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Locked</th><th>Actions</th></tr></thead>
                        <tbody>
                            {filteredUsers.map(user => (
                                <tr key={user.id}>
                                    <td data-label="Name">{user.name}</td>
                                    <td data-label="Role">{user.role}</td>
                                    <td data-label="Status"><span className={`status-pill ${user.status}`}>{user.status.replace('_', ' ')}</span></td>
                                    <td data-label="Locked">{user.isLocked ? 'Yes' : 'No'}</td>
                                    <td data-label="Actions">
                                        <div className="entry-actions">
                                            <button onClick={() => setEditingUser(user)}>{Icons.editPencil}</button>
                                            <button onClick={() => toggleUserLock(user.id)}>{user.isLocked ? Icons.lockOpen : Icons.lockClosed}</button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
            <Modal isOpen={!!editingUser} onClose={() => setEditingUser(null)} title={`Edit User: ${editingUser?.name}`}>
                {editingUser && (
                    <form onSubmit={handleSave}>
                        <div className="control-group"> <label htmlFor="edit-name">Name</label> <input id="edit-name" type="text" className="form-control" value={editingUser.name} onChange={e => setEditingUser(u => u ? {...u, name: e.target.value} : null)} /> </div>
                        <div className="control-group"> <label htmlFor="edit-role">Role</label> <select id="edit-role" className="form-control" value={editingUser.role} onChange={e => setEditingUser(u => u ? {...u, role: e.target.value as UserRole} : null)}> {Object.keys(APP_VIEWS_CONFIG).flatMap(k => APP_VIEWS_CONFIG[k as AppView].roles).filter((v,i,a)=>a.indexOf(v)===i).map(r => <option key={r} value={r}>{r}</option>)} </select> </div>
                        <div className="form-actions"> <button className="btn btn-secondary" onClick={() => setEditingUser(null)}>Cancel</button> <button type="submit" className="btn btn-primary">Save Changes</button> </div>
                    </form>
                )}
            </Modal>
        </div>
    );
};

const SettingsView = () => {
    const { settings, updateSettings, addNotification } = useAppContext();
    const [accentColor, setAccentColor] = useState(settings.accentColor);
    const [timeSlotsText, setTimeSlotsText] = useState(settings.timeSlots.join('\n'));

    const handleSave = () => {
        const timeSlots = timeSlotsText.split('\n').filter(Boolean);
        if (timeSlots.length < 1) {
            addNotification("You must have at least one time slot.", "error");
            return;
        }
        updateSettings({ accentColor, timeSlots });
    };

    return (
        <div className="settings-container">
            <div className="dashboard-card">
                <h3>Application Settings</h3>
                <div className="settings-form">
                    <div className="control-group">
                        <label htmlFor="accent-color">Accent Color</label>
                        <div className="color-picker-wrapper">
                             <input id="accent-color" type="color" value={accentColor} onChange={e => setAccentColor(e.target.value)} />
                             <span>{accentColor}</span>
                        </div>
                    </div>
                     <div className="control-group">
                        <label htmlFor="time-slots">Time Slots (one per line)</label>
                        <textarea id="time-slots" className="form-control" rows={10} value={timeSlotsText} onChange={e => setTimeSlotsText(e.target.value)}></textarea>
                    </div>
                    <div className="form-actions">
                        <button className="btn btn-primary" onClick={handleSave}>Save Settings</button>
                    </div>
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
        case 'academicCalendar': return <AcademicCalendarView />;
        case 'resources': return <ResourcesView />;
        case 'studentDirectory': return <StudentDirectoryView />;
        case 'approvals': return <ApprovalsView />;
        case 'announcements': return <AnnouncementsView />;
        case 'courseFiles': return <CourseFilesView />;
        case 'manage': return <ManageTimetableView />;
        case 'userManagement': return <UserManagementView />;
        case 'security': return <SecurityView />;
        case 'settings': return <SettingsView />;
        default: return <DashboardView />;
    }
};

const App = () => {
    const { currentUser, isSidebarOpen, toggleSidebar } = useAppContext();
    const [isChatOpen, setIsChatOpen] = useState(false);

    if (!currentUser) return <AuthView />;

    return (
        <div className={`app-container ${isSidebarOpen ? 'sidebar-open' : ''}`}>
            <Sidebar />
            <div className="sidebar-overlay" onClick={toggleSidebar}></div>
            <main className="main-content">
                <Header />
                <div className="page-content"><PageContent /></div>
            </main>
            <DraggableBubble onClick={() => setIsChatOpen(true)}>{Icons.chatbot}</DraggableBubble>
            <ChatbotWindow isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} />
        </div>
    );
};

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(
        <React.StrictMode>
            <AppProvider> <App /> </AppProvider>
        </React.StrictMode>
    );
}