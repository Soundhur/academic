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
    author: string;
    authorId: string;
    timestamp: number;
    targetRole: 'all' | 'student' | 'faculty';
    targetDept: 'all' | 'CSE' | 'ECE' | 'EEE' | 'MCA' | 'AI&DS' | 'CYBERSECURITY' | 'MECHANICAL' | 'TAMIL' | 'ENGLISH' | 'MATHS' | 'LIB' | 'NSS' | 'NET';
    reactions?: { [emoji: string]: string[] }; // Emoji: [userId1, userId2]
}
interface ChatMessage {
    id:string;
    role: 'user' | 'model';
    text: string;
    isError?: boolean;
    imageUrl?: string;
    sources?: { uri: string; title: string; }[];
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
    aiRiskAnalysis?: {
        riskLevel: 'Low' | 'Moderate' | 'High';
        rationale: string;
        interventions: string[];
        timestamp: number;
    };
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
        timestamp: number;
    };
}

interface CalendarEvent {
    id: string;
    date: string; // Using ISO string for easier storage
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

interface StudyPlan {
    title: string;
    weeks: {
        week: number;
        days: {
            day: string;
            topic: string;
            tasks: { text: string; completed: boolean; }[];
        }[];
    }[];
}

const DEPARTMENTS = ["CSE", "ECE", "EEE", "MCA", "AI&DS", "CYBERSECURITY", "MECHANICAL", "TAMIL", "ENGLISH", "MATHS", "LIB", "NSS", "NET"];
const USER_ROLES: UserRole[] = ['student', 'faculty', 'hod', 'admin', 'class advisor', 'principal', 'creator'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

const MOCK_SETTINGS: AppSettings = {
    timeSlots: [
        '09:00 - 09:50',
        '09:50 - 10:35',
        '10:35 - 10:50', // Break
        '10:50 - 11:35',
        '11:35 - 12:20',
        '12:20 - 13:05',
        '13:05 - 14:00', // Lunch
        '14:00 - 14:50',
        '14:50 - 15:40',
        '15:40 - 16:30'
    ],
    accentColor: '#3B82F6',
};

const MOCK_USERS_INITIAL: User[] = [
    { id: 'admin', name: 'Admin', role: 'admin', dept: 'System', status: 'active', isLocked: false, password: 'password' },
    { id: 'principal', name: 'Dr. Principal', role: 'principal', dept: 'Management', status: 'active', isLocked: false, password: 'password' },
    { id: 'hod_cse', name: 'HOD (CSE)', role: 'hod', dept: 'CSE', status: 'active', isLocked: false, password: 'password' },
    { id: 'stud001', name: 'Alice', role: 'student', dept: 'CSE', year: 'II', status: 'active', grades: [{ subject: 'Data Structures', score: 85 }, { subject: 'OOPs', score: 72 }], attendance: { present: 78, total: 80 }, isLocked: false, password: 'password' },
    { id: 'stud003', name: 'Eve', role: 'student', dept: 'CSE', year: 'II', status: 'active', grades: [{ subject: 'Data Structures', score: 65 }, { subject: 'OOPs', score: 55 }], attendance: { present: 60, total: 80 }, isLocked: false, password: 'password', aiRiskAnalysis: { riskLevel: 'High', rationale: 'Low attendance and declining grades in core subjects.', interventions: ['Mandatory counseling session', 'Additional tutoring for OOPs'], timestamp: Date.now() - 86400000 * 3 } },
    { id: 'stud002', name: 'Bob', role: 'student', dept: 'ECE', year: 'III', status: 'pending_approval', isLocked: false, password: 'password' },
    { id: 'fac001', name: 'Prof. Charlie', role: 'faculty', dept: 'CSE', status: 'active', isLocked: false, password: 'password' },
    { id: 'fac002', name: 'Prof. Diana', role: 'faculty', dept: 'ECE', status: 'rejected', isLocked: false, password: 'password' },
    { id: 'creator', name: 'App Creator', role: 'creator', dept: 'System', status: 'active', isLocked: false, password: 'password' }
];

const MOCK_ANNOUNCEMENTS_INITIAL: Announcement[] = [
    { id: 'ann001', title: 'Mid-term Exams', content: 'Mid-term exams for all departments will commence from next week. Please collect your hall tickets.', author: 'Admin', authorId: 'admin', timestamp: Date.now() - 86400000, targetRole: 'all', targetDept: 'all', reactions: { '👍': ['stud001', 'fac001'] } },
    { id: 'ann002', title: 'Project Submission Deadline', content: 'Final year project submissions are due this Friday. No extensions will be provided.', author: 'HOD (CSE)', authorId: 'hod_cse', timestamp: Date.now() - 172800000, targetRole: 'student', targetDept: 'CSE' }
];

const MOCK_TIMETABLE_INITIAL: TimetableEntry[] = [
    // Monday
    { id: 'tt_mon_0', department: 'CSE', year: 'II', day: 'Monday', timeIndex: 0, subject: 'Discrete Mathematics', type: 'class', faculty: 'Ms. YUVASRI', room: 'A212' },
    { id: 'tt_mon_1', department: 'CSE', year: 'II', day: 'Monday', timeIndex: 1, subject: 'Object Oriented Programming', type: 'class', faculty: 'Ms. MYSHREE B', room: 'A212' },
    { id: 'tt_mon_2', department: 'CSE', year: 'II', day: 'Monday', timeIndex: 2, subject: 'Break', type: 'break' },
    { id: 'tt_mon_3', department: 'CSE', year: 'II', day: 'Monday', timeIndex: 3, subject: 'Digital Principles & Comp. Org.', type: 'class', faculty: 'Mrs. THANGAMANI', room: 'A212' },
    { id: 'tt_mon_4', department: 'CSE', year: 'II', day: 'Monday', timeIndex: 4, subject: 'Data Structures', type: 'class', faculty: 'Mr. SOUNDHUR', room: 'A212' },
    { id: 'tt_mon_5', department: 'CSE', year: 'II', day: 'Monday', timeIndex: 5, subject: 'FDS', type: 'class', room: 'A212' },
    { id: 'tt_mon_6', department: 'CSE', year: 'II', day: 'Monday', timeIndex: 6, subject: 'Lunch', type: 'break' },
    { id: 'tt_mon_7', department: 'CSE', year: 'II', day: 'Monday', timeIndex: 7, subject: 'OOPS Lab', type: 'class', faculty: 'Ms. MYSHREE B', room: 'A212' },
    { id: 'tt_mon_8', department: 'CSE', year: 'II', day: 'Monday', timeIndex: 8, subject: 'OOPS Lab', type: 'class', faculty: 'Ms. MYSHREE B', room: 'A212' },
    // Tuesday
    { id: 'tt_tue_0', department: 'CSE', year: 'II', day: 'Tuesday', timeIndex: 0, subject: 'Digital Principles & Comp. Org.', type: 'class', faculty: 'Mrs. THANGAMANI', room: 'A212' },
    { id: 'tt_tue_1', department: 'CSE', year: 'II', day: 'Tuesday', timeIndex: 1, subject: 'Data Structures', type: 'class', faculty: 'Mr. SOUNDHUR', room: 'A212' },
    { id: 'tt_tue_2', department: 'CSE', year: 'II', day: 'Tuesday', timeIndex: 2, subject: 'Break', type: 'break' },
    { id: 'tt_tue_3', department: 'CSE', year: 'II', day: 'Tuesday', timeIndex: 3, subject: 'FDS Lab', type: 'class', room: 'A212' },
    { id: 'tt_tue_4', department: 'CSE', year: 'II', day: 'Tuesday', timeIndex: 4, subject: 'FDS Lab', type: 'class', room: 'A212' },
    { id: 'tt_tue_5', department: 'CSE', year: 'II', day: 'Tuesday', timeIndex: 5, subject: 'FDS Lab', type: 'class', room: 'A212' },
    { id: 'tt_tue_6', department: 'CSE', year: 'II', day: 'Tuesday', timeIndex: 6, subject: 'Lunch', type: 'break' },
    { id: 'tt_tue_7', department: 'CSE', year: 'II', day: 'Tuesday', timeIndex: 7, subject: 'Discrete Mathematics', type: 'class', faculty: 'Ms. YUVASRI', room: 'A212' },
    { id: 'tt_tue_8', department: 'CSE', year: 'II', day: 'Tuesday', timeIndex: 8, subject: 'Discrete Mathematics', type: 'class', faculty: 'Ms. YUVASRI', room: 'A212' },
];

const MOCK_COURSE_FILES_INITIAL: CourseFile[] = [
    { id: 'cf001', facultyId: 'fac001', facultyName: 'Prof. Charlie', department: 'CSE', subject: 'Data Structures', semester: 'IV', files: [{ name: 'Syllabus.pdf', type: 'syllabus' }, { name: 'Unit1_Notes.pdf', type: 'notes' }], status: 'pending_review', submittedAt: Date.now() - 86400000 * 2 },
    { id: 'cf002', facultyId: 'fac002', facultyName: 'Prof. Diana', department: 'ECE', subject: 'Circuit Theory', semester: 'III', files: [{ name: 'Syllabus.pdf', type: 'syllabus' }], status: 'approved', submittedAt: Date.now() - 86400000 * 5 },
];

const MOCK_RESOURCES_INITIAL: Resource[] = [
    { id: 'res001', name: 'Data Structures & Algorithms', type: 'book', department: 'CSE', subject: 'Data Structures', uploaderId: 'fac001', uploaderName: 'Prof. Charlie', timestamp: Date.now() - 86400000 * 3 },
    { id: 'res002', name: 'OOPs Concepts Slides', type: 'notes', department: 'CSE', subject: 'OOPs', uploaderId: 'fac001', uploaderName: 'Prof. Charlie', timestamp: Date.now() - 86400000 * 4 },
    { id: 'res003', name: 'Digital Logic Design Lab Manual', type: 'lab', department: 'ECE', subject: 'Digital Logic', uploaderId: 'fac002', uploaderName: 'Prof. Diana', timestamp: Date.now() - 86400000 * 5 },
    { id: 'res004', name: 'Final Year Project Template', type: 'project', department: 'all', subject: 'General', uploaderId: 'hod_cse', uploaderName: 'HOD (CSE)', timestamp: Date.now() - 86400000 * 10 },
];

const MOCK_CALENDAR_EVENTS_INITIAL: CalendarEvent[] = [
    { id: 'cal001', date: new Date(Date.now() + 86400000 * 7).toISOString().split('T')[0], title: 'Internal Assessment I Starts', type: 'exam' },
    { id: 'cal002', date: new Date(Date.now() + 86400000 * 14).toISOString().split('T')[0], title: 'National Science Day Symposium', type: 'event' },
    { id: 'cal003', date: new Date(Date.now() + 86400000 * 20).toISOString().split('T')[0], title: 'Fee Payment Deadline', type: 'deadline' },
    { id: 'cal004', date: new Date(Date.now() + 86400000 * 25).toISOString().split('T')[0], title: 'Summer Holiday Begins', type: 'holiday' },
];

const MOCK_AUDIT_LOGS: AuditLogEntry[] = [
    { id: 'al001', timestamp: Date.now() - 10000, userId: 'admin', userName: 'Admin', action: 'LOGIN_SUCCESS', ip: '192.168.1.1', status: 'success' },
    { id: 'al002', timestamp: Date.now() - 25000, userId: 'stud002', userName: 'Bob', action: 'APPROVAL_REQUEST', ip: '203.0.113.25', status: 'info', details: 'User requested account approval.' },
    { id: 'al003', timestamp: Date.now() - 35000, userId: 'hod_cse', userName: 'HOD (CSE)', action: 'UPDATE_TIMETABLE', ip: '198.51.100.10', status: 'success', details: 'Updated CSE II Year timetable.' },
    { id: 'al004', timestamp: Date.now() - 45000, userId: 'unknown', userName: 'N/A', action: 'LOGIN_FAILURE', ip: '192.0.2.14', status: 'failure', details: 'Failed login attempt for user: guest' },
];

const MOCK_SECURITY_ALERTS: SecurityAlert[] = [
    { id: 'sa001', type: 'Anomaly', title: 'Multiple Failed Logins', description: 'User account "fac002" had 5 failed login attempts in 2 minutes.', timestamp: Date.now() - 60000, severity: 'high', relatedUserId: 'fac002', isResolved: false, responsePlan: { containment: 'Temporarily lock user account.', investigation: 'Verify login attempts with user.', recovery: 'Reset password if necessary.', recommendedAction: 'LOCK_USER' } },
    { id: 'sa002', type: 'Threat', title: 'Potential SQL Injection', description: 'Anomalous query pattern detected from IP 192.0.2.14.', timestamp: Date.now() - 120000, severity: 'critical', isResolved: false, responsePlan: { containment: 'Block IP at firewall.', investigation: 'Analyze web server logs for malicious activity.', recovery: 'Patch vulnerable endpoint.', recommendedAction: 'MONITOR' } },
];

// --- UTILITY & HELPER HOOKS ---
const useLocalStorage = <T,>(key: string, initialValue: T): [T, React.Dispatch<React.SetStateAction<T>>] => {
    const [storedValue, setStoredValue] = useState<T>(() => {
        try {
            const item = window.localStorage.getItem(key);
            return item ? JSON.parse(item) : initialValue;
        } catch (error) {
            console.error(error);
            return initialValue;
        }
    });

    const setValue: React.Dispatch<React.SetStateAction<T>> = (value) => {
        try {
            const valueToStore = value instanceof Function ? value(storedValue) : value;
            setStoredValue(valueToStore);
            window.localStorage.setItem(key, JSON.stringify(valueToStore));
        } catch (error) {
            console.error(error);
        }
    };

    return [storedValue, setValue];
};

const formatDate = (timestamp: number, options?: Intl.DateTimeFormatOptions) => {
    const defaultOptions: Intl.DateTimeFormatOptions = {
        year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
    };
    return new Date(timestamp).toLocaleDateString('en-US', options || defaultOptions);
};

const AppContext = createContext<any>(null);


// --- SVG ICONS ---
const Icons = {
    dashboard: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 8.25 20.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6A2.25 2.25 0 0 1 15.75 3.75h2.25A2.25 2.25 0 0 1 20.25 6v2.25a2.25 2.25 0 0 1-2.25 2.25H15.75A2.25 2.25 0 0 1 13.5 8.25V6ZM13.5 15.75A2.25 2.25 0 0 1 15.75 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18.25 20.25H15.75A2.25 2.25 0 0 1 13.5 18v-2.25Z" /></svg>,
    timetable: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0h18M-4.5 12h22.5" /></svg>,
    announcements: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 0 1 0-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 0 1-1.44-4.282m3.102.069a18.03 18.03 0 0 1-.59-4.59c0-1.708.226-3.362.654-4.945a20.845 20.845 0 0 1 1.44-4.282m.058 9.287c.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 0 1-1.44-4.282M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Zm0 0a8.949 8.949 0 0 0 5.022-1.612m-10.044 0A8.949 8.949 0 0 0 12 21Z" /></svg>,
    approvals: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>,
    userManagement: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-2.272M15 19.128v-3.872M15 19.128A9.37 9.37 0 0 1 12.125 21a9.37 9.37 0 0 1-2.875-.872M15 19.128a9.37 9.37 0 0 0-2.875-.872M12 15c-2.485 0-4.5-2.015-4.5-4.5s2.015-4.5 4.5-4.5 4.5 2.015 4.5 4.5-2.015 4.5-4.5 4.5ZM12 15v6.375m0-6.375a9.37 9.37 0 0 1-2.875.872M8.25 15a9.37 9.37 0 0 1-2.875.872M8.25 15v6.375m0-6.375a9.37 9.37 0 0 0-2.875.872m2.875.872a9.37 9.37 0 0 1-2.875-.872M3.375 19.128a9.38 9.38 0 0 1-2.625.372 9.337 9.337 0 0 1-4.121-2.272M3.375 19.128v-3.872M3.375 19.128A9.37 9.37 0 0 0 6.25 21a9.37 9.37 0 0 0 2.875-.872M3.375 19.128A9.37 9.37 0 0 1 6.25 15m6.125-6.375a9.37 9.37 0 0 1-2.875-.872M12 8.625a9.37 9.37 0 0 0-2.875-.872" /></svg>,
    studentDirectory: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-2.272M15 19.128v-3.872M15 19.128A9.37 9.37 0 0 1 12.125 21a9.37 9.37 0 0 1-2.875-.872M15 19.128a9.37 9.37 0 0 0-2.875-.872M12 15c-2.485 0-4.5-2.015-4.5-4.5s2.015-4.5 4.5-4.5 4.5 2.015 4.5 4.5-2.015 4.5-4.5 4.5ZM12 15v6.375m0-6.375a9.37 9.37 0 0 1-2.875.872M8.25 15a9.37 9.37 0 0 1-2.875.872M8.25 15v6.375m0-6.375a9.37 9.37 0 0 0-2.875.872m2.875.872a9.37 9.37 0 0 1-2.875-.872M3.375 19.128a9.38 9.38 0 0 1-2.625.372 9.337 9.337 0 0 1-4.121-2.272M3.375 19.128v-3.872M3.375 19.128A9.37 9.37 0 0 0 6.25 21a9.37 9.37 0 0 0 2.875-.872M3.375 19.128A9.37 9.37 0 0 1 6.25 15m6.125-6.375a9.37 9.37 0 0 1-2.875-.872M12 8.625a9.37 9.37 0 0 0-2.875-.872" /></svg>,
    courseFiles: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>,
    resources: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" /></svg>,
    academicCalendar: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0h18M-4.5 12h22.5" /></svg>,
    security: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>,
    settings: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0M3.75 18H7.5m3-6h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0M3.75 12H7.5" /></svg>,
    logout: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" /></svg>,
    logo: () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"></path></svg>,
    close: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>,
    menu: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg>,
    moon: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" /></svg>,
    sun: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" /></svg>,
    send: () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"></path></svg>,
    microphone: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m12 5.25v-1.5a6 6 0 0 0-12 0v1.5m12 0a9 9 0 1 1-18 0a9 9 0 0 1 18 0Z" /></svg>,
    sparkles: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" /></svg>,
    check: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>,
    xmark: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>,
    lock: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>,
    unlock: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>,
    userCircle: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>,
    book: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" /></svg>,
    notes: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" /></svg>,
    project: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h6M9 11.25h6M9 15.75h6" /></svg>,
    lab: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75H6A2.25 2.25 0 0 0 3.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0 1 20.25 6v1.5m0 9V18A2.25 2.25 0 0 1 18 20.25h-1.5m-9 0H6A2.25 2.25 0 0 1 3.75 18v-1.5M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>,
    other: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.125 1.125 0 0 1 0 2.25H5.625a1.125 1.125 0 0 1 0-2.25Z" /></svg>,
    info: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" /></svg>,
    warning: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" /></svg>,
    critical: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" /></svg>,
    edit: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" /></svg>,
    trash: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>,
};

// --- App Structure & Components ---

const App = () => {
    const [theme, setTheme] = useLocalStorage('theme', 'light');
    const [settings, setSettings] = useLocalStorage<AppSettings>('settings', MOCK_SETTINGS);
    const [currentUser, setCurrentUser] = useLocalStorage<User | null>('currentUser', null);
    const [currentView, setCurrentView] = useLocalStorage<AppView>('currentView', 'auth');
    const [users, setUsers] = useLocalStorage<User[]>('users', MOCK_USERS_INITIAL);
    const [announcements, setAnnouncements] = useLocalStorage<Announcement[]>('announcements', MOCK_ANNOUNCEMENTS_INITIAL);
    const [timetable, setTimetable] = useLocalStorage<TimetableEntry[]>('timetable', MOCK_TIMETABLE_INITIAL);
    const [courseFiles, setCourseFiles] = useLocalStorage<CourseFile[]>('courseFiles', MOCK_COURSE_FILES_INITIAL);
    const [resources, setResources] = useLocalStorage<Resource[]>('resources', MOCK_RESOURCES_INITIAL);
    const [calendarEvents, setCalendarEvents] = useLocalStorage<CalendarEvent[]>('calendarEvents', MOCK_CALENDAR_EVENTS_INITIAL);

    const [isSidebarOpen, setSidebarOpen] = useState(false);
    const [notifications, setNotifications] = useState<AppNotification[]>([]);

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
    }, [theme]);
    
    useEffect(() => {
        document.documentElement.style.setProperty('--accent-primary', settings.accentColor);
    }, [settings.accentColor]);

    useEffect(() => {
        if (!currentUser) {
            setCurrentView('auth');
        } else if (currentView === 'auth') {
            setCurrentView('dashboard');
        }
    }, [currentUser, currentView, setCurrentView]);

    const addNotification = useCallback((message: string, type: AppNotification['type']) => {
        const id = `notif_${Date.now()}`;
        setNotifications(prev => [...prev, { id, message, type }]);
    }, []);

    const appContextValue = {
        currentUser, setCurrentUser,
        currentView, setCurrentView,
        users, setUsers,
        announcements, setAnnouncements,
        timetable, setTimetable,
        courseFiles, setCourseFiles,
        resources, setResources,
        calendarEvents, setCalendarEvents,
        settings, setSettings,
        addNotification,
        theme, setTheme
    };

    if (!currentUser) {
        return (
            <AppContext.Provider value={appContextValue}>
                <AuthView />
            </AppContext.Provider>
        );
    }

    return (
        <AppContext.Provider value={appContextValue}>
            <div className={`app-container ${isSidebarOpen ? 'sidebar-open' : ''}`}>
                <Sidebar isSidebarOpen={isSidebarOpen} setSidebarOpen={setSidebarOpen} />
                <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)}></div>
                <MainContent isSidebarOpen={isSidebarOpen} setSidebarOpen={setSidebarOpen} />
                <Chatbot />
            </div>
            <NotificationContainer notifications={notifications} setNotifications={setNotifications} />
        </AppContext.Provider>
    );
};

// --- MAIN CONTENT & ROUTING ---
const MainContent = ({ isSidebarOpen, setSidebarOpen }) => {
    const { currentView } = useContext(AppContext);
    
    const viewTitle = useMemo(() => {
        const titles: Record<AppView, string> = {
            dashboard: 'Dashboard',
            timetable: 'Timetable',
            announcements: 'Announcements',
            approvals: 'Approvals',
            userManagement: 'User Management',
            studentDirectory: 'Student Directory',
            courseFiles: 'Course Files',
            resources: 'Resources',
            academicCalendar: 'Academic Calendar',
            security: 'Security & Audit',
            settings: 'Settings',
            auth: 'Authentication',
            manage: 'Manage',
        };
        return titles[currentView] || 'Dashboard';
    }, [currentView]);

    const renderView = () => {
        switch (currentView) {
            case 'dashboard': return <DashboardView />;
            case 'timetable': return <TimetableView />;
            case 'announcements': return <AnnouncementsView />;
            case 'userManagement': return <UserManagementView />;
            case 'studentDirectory': return <StudentDirectoryView />;
            case 'courseFiles': return <CourseFilesView />;
            case 'security': return <SecurityView />;
            case 'settings': return <SettingsView />;
            case 'resources': return <ResourcesView />;
            case 'academicCalendar': return <AcademicCalendarView />;
            default: return <DashboardView />;
        }
    };

    return (
        <main className="main-content">
            <Header title={viewTitle} setSidebarOpen={setSidebarOpen} />
            <div className="page-content">
                {renderView()}
            </div>
        </main>
    );
};

// --- CORE UI COMPONENTS ---

const Header = ({ title, setSidebarOpen }) => {
    const { currentUser, theme, setTheme } = useContext(AppContext);

    const toggleTheme = () => {
        setTheme(theme === 'light' ? 'dark' : 'light');
    };

    return (
        <header className="header">
            <div className="header-left">
                 <button className="menu-toggle" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar">
                    <Icons.menu />
                </button>
                <h2 className="header-title">{title}</h2>
            </div>
            <div className="header-right">
                <div className="user-info">
                    <strong>{currentUser.name}</strong> - <small>{currentUser.role}</small>
                </div>
                 <button className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
                    {theme === 'light' ? <Icons.moon /> : <Icons.sun />}
                </button>
            </div>
        </header>
    );
};

const Sidebar = ({ isSidebarOpen, setSidebarOpen }) => {
    const { currentUser, setCurrentUser, currentView, setCurrentView } = useContext(AppContext);

    const handleLogout = () => {
        setCurrentUser(null);
        setCurrentView('auth');
    };

    const navItems = useMemo(() => {
        const allItems = [
            { view: 'dashboard', label: 'Dashboard', icon: <Icons.dashboard />, roles: USER_ROLES },
            { view: 'timetable', label: 'Timetable', icon: <Icons.timetable />, roles: ['student', 'faculty', 'hod', 'class advisor', 'principal', 'creator', 'admin'] },
            { view: 'announcements', label: 'Announcements', icon: <Icons.announcements />, roles: USER_ROLES },
            { view: 'userManagement', label: 'User Management', icon: <Icons.userManagement />, roles: ['admin', 'principal', 'hod'] },
            { view: 'studentDirectory', label: 'Student Directory', icon: <Icons.studentDirectory />, roles: ['faculty', 'hod', 'class advisor', 'principal', 'admin'] },
            { view: 'courseFiles', label: 'Course Files', icon: <Icons.courseFiles />, roles: ['faculty', 'hod', 'principal'] },
            { view: 'resources', label: 'Resources', icon: <Icons.resources />, roles: ['student', 'faculty', 'hod', 'admin'] },
            { view: 'academicCalendar', label: 'Academic Calendar', icon: <Icons.academicCalendar />, roles: USER_ROLES },
            { view: 'security', label: 'Security', icon: <Icons.security />, roles: ['admin'] },
            { view: 'settings', label: 'Settings', icon: <Icons.settings />, roles: USER_ROLES },
        ];
        return allItems.filter(item => item.roles.includes(currentUser.role));
    }, [currentUser.role]);

    return (
        <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
             <div className="sidebar-header">
                <span className="logo"><Icons.logo/></span>
                <h1>AcademiaAI</h1>
                <button className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar">
                    <Icons.close />
                </button>
            </div>
            <nav className="nav-list">
                <ul>
                    {navItems.map(item => (
                         <li key={item.view} className="nav-item">
                            <button className={currentView === item.view ? 'active' : ''} onClick={() => { setCurrentView(item.view); setSidebarOpen(false); }}>
                                {item.icon}
                                <span>{item.label}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            </nav>
            <div className="sidebar-footer">
                <div className="sidebar-actions">
                     <button onClick={handleLogout} className="logout-btn" title="Logout">
                        <Icons.logout />
                    </button>
                </div>
            </div>
        </aside>
    );
};

// --- VIEWS ---

const DashboardView = () => {
    const { currentUser } = useContext(AppContext);

    switch(currentUser.role) {
        case 'student': return <StudentDashboard />;
        case 'hod':
        case 'principal':
            return <HODDashboard />;
        case 'faculty':
        case 'class advisor':
            return <FacultyDashboard />;
        case 'admin':
            return <AdminDashboard />;
        default:
            return <GenericDashboard />;
    }
};

const GenericDashboard = () => {
    const { currentUser } = useContext(AppContext);
     return (
        <div className="dashboard-container">
            <h2 className="dashboard-greeting">Welcome, {currentUser.name}!</h2>
            <p className="dashboard-subtitle">Your academic portal is ready.</p>
        </div>
    );
};

const StudentDashboard = () => {
    const { currentUser, timetable, announcements } = useContext(AppContext);
    
    const today = DAYS[new Date().getDay() -1] || 'Monday';
    const todaysClasses = timetable.filter(c => c.day === today && c.department === currentUser.dept && c.year === currentUser.year).sort((a,b) => a.timeIndex - b.timeIndex);
    const relevantAnnouncements = announcements.filter(a => (a.targetDept === 'all' || a.targetDept === currentUser.dept) && (a.targetRole === 'all' || a.targetRole === 'student')).slice(0, 3);
    
    return (
        <div className="dashboard-container">
             <h2 className="dashboard-greeting">Hello, {currentUser.name}!</h2>
             <p className="dashboard-subtitle">Here's what's happening today.</p>
             <div className="dashboard-grid">
                <div className="dashboard-card full-width ai-feature-card">
                    <AIStudyPlanGenerator />
                </div>
                <div className="dashboard-card">
                    <h3>Today's Classes</h3>
                    <div className="feed-list">
                        {todaysClasses.length > 0 ? todaysClasses.map((c, i) => (
                            <div key={c.id} className="feed-item-card stagger-item" style={{animationDelay: `${i * 100}ms`}}>
                                <div className="feed-item-icon" style={{color: 'var(--accent-primary)'}}><Icons.timetable /></div>
                                <div>
                                    <p className="feed-item-title">{c.subject}</p>
                                    <p className="feed-item-meta">{MOCK_SETTINGS.timeSlots[c.timeIndex]} - {c.type === 'class' ? `Room ${c.room}` : 'Break'}</p>
                                </div>
                            </div>
                        )) : <p>No classes scheduled for today.</p>}
                    </div>
                </div>
                <div className="dashboard-card">
                    <h3>Recent Announcements</h3>
                    <div className="feed-list">
                       {relevantAnnouncements.map((a, i) => (
                            <div key={a.id} className="feed-item-card stagger-item" style={{animationDelay: `${i * 100}ms`}}>
                                <div className="feed-item-icon" style={{color: 'var(--accent-warning)'}}><Icons.announcements /></div>
                                <div>
                                    <p className="feed-item-title">{a.title}</p>
                                    <p className="feed-item-meta">By {a.author} - {formatDate(a.timestamp, {month: 'short', day: 'numeric'})}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
             </div>
        </div>
    );
};

const HODDashboard = () => {
    const { users, courseFiles, setCurrentView } = useContext(AppContext);
    const pendingApprovals = users.filter(u => u.status === 'pending_approval' && u.dept === 'CSE');
    const studentCount = users.filter(u => u.role === 'student' && u.dept === 'CSE').length;
    const facultyCount = users.filter(u => u.role === 'faculty' && u.dept === 'CSE').length;
    const pendingCourseFiles = courseFiles.filter(cf => cf.status === 'pending_review');

    return (
        <div className="dashboard-container">
            <h2 className="dashboard-greeting">Management Dashboard</h2>
            <div className="principal-stats-grid">
                <div className="stat-card stagger-item"><h3 className="stat-title">Students (CSE)</h3><p className="stat-value">{studentCount}</p></div>
                <div className="stat-card stagger-item" style={{animationDelay: '100ms'}}><h3 className="stat-title">Faculty (CSE)</h3><p className="stat-value">{facultyCount}</p></div>
                <div className="stat-card stagger-item" style={{animationDelay: '200ms'}}><h3 className="stat-title">Pending Approvals</h3><p className="stat-value">{pendingApprovals.length}</p></div>
                <div className="stat-card stagger-item" style={{animationDelay: '300ms'}}><h3 className="stat-title">Course Files to Review</h3><p className="stat-value">{pendingCourseFiles.length}</p></div>
            </div>
             <div className="dashboard-grid">
                <div className="dashboard-card">
                    <h3>Pending User Approvals</h3>
                     <div className="feed-list">
                        {pendingApprovals.length > 0 ? pendingApprovals.slice(0, 5).map(u => (
                            <div key={u.id} className="feed-item-card">
                                <div className="feed-item-icon"><Icons.userCircle /></div>
                                <div>
                                    <p className="feed-item-title">{u.name} ({u.role})</p>
                                    <p className="feed-item-meta">Dept: {u.dept}</p>
                                </div>
                            </div>
                        )) : <p>No pending approvals in your department.</p>}
                        {pendingApprovals.length > 0 && <button className="btn-link" onClick={() => setCurrentView('userManagement')}>View All</button>}
                    </div>
                </div>
                 <div className="dashboard-card">
                    <h3>Pending Course File Reviews</h3>
                     <div className="feed-list">
                       {pendingCourseFiles.length > 0 ? pendingCourseFiles.slice(0, 5).map(cf => (
                            <div key={cf.id} className="feed-item-card">
                                <div className="feed-item-icon" style={{color: 'var(--accent-warning)'}}><Icons.courseFiles /></div>
                                <div>
                                    <p className="feed-item-title">{cf.subject} - {cf.semester} Sem</p>
                                    <p className="feed-item-meta">by {cf.facultyName}</p>
                                </div>
                            </div>
                        )) : <p>No course files to review.</p>}
                         {pendingCourseFiles.length > 0 && <button className="btn-link" onClick={() => setCurrentView('courseFiles')}>Review Files</button>}
                    </div>
                </div>
             </div>
        </div>
    );
};

const FacultyDashboard = () => {
    const { currentUser, timetable, courseFiles } = useContext(AppContext);
    
    const today = DAYS[new Date().getDay() -1] || 'Monday';
    const todaysClasses = timetable.filter(c => c.day === today && c.faculty === currentUser.name).sort((a,b) => a.timeIndex - b.timeIndex);
    const mySubmissions = courseFiles.filter(cf => cf.facultyId === currentUser.id).slice(0, 3);
    
    return (
        <div className="dashboard-container">
             <h2 className="dashboard-greeting">Welcome, {currentUser.name}!</h2>
             <p className="dashboard-subtitle">Here is your schedule and recent activity.</p>
             <div className="dashboard-grid">
                <div className="dashboard-card">
                    <h3>Today's Classes</h3>
                    <div className="feed-list">
                        {todaysClasses.length > 0 ? todaysClasses.map((c, i) => (
                            <div key={c.id} className="feed-item-card stagger-item" style={{animationDelay: `${i * 100}ms`}}>
                                <div className="feed-item-icon"><Icons.timetable /></div>
                                <div>
                                    <p className="feed-item-title">{c.subject}</p>
                                    <p className="feed-item-meta">{c.department} - Year {c.year} | {MOCK_SETTINGS.timeSlots[c.timeIndex]}</p>
                                </div>
                            </div>
                        )) : <p>No classes scheduled for you today.</p>}
                    </div>
                </div>
                <div className="dashboard-card">
                    <h3>Recent Course File Submissions</h3>
                    <div className="feed-list">
                       {mySubmissions.length > 0 ? mySubmissions.map((cf, i) => (
                            <div key={cf.id} className="feed-item-card stagger-item" style={{animationDelay: `${i * 100}ms`}}>
                                <div className="feed-item-icon" style={{color: 'var(--accent-warning)'}}><Icons.courseFiles /></div>
                                <div>
                                    <p className="feed-item-title">{cf.subject}</p>
                                    <p className="feed-item-meta">Status: <span className={`status-badge status-${cf.status}`}>{cf.status.replace('_', ' ')}</span></p>
                                </div>
                            </div>
                        )) : <p>You have not submitted any course files recently.</p>}
                    </div>
                </div>
             </div>
        </div>
    );
};

const AdminDashboard = () => {
    const { users, setCurrentView } = useContext(AppContext);
    const pendingApprovals = users.filter(u => u.status === 'pending_approval');
    const totalUsers = users.length;
    const lockedUsers = users.filter(u => u.isLocked).length;
    const activeAlerts = MOCK_SECURITY_ALERTS.filter(a => !a.isResolved);

    return (
        <div className="dashboard-container">
            <h2 className="dashboard-greeting">System Administration</h2>
            <div className="principal-stats-grid">
                <div className="stat-card stagger-item"><h3 className="stat-title">Total Users</h3><p className="stat-value">{totalUsers}</p></div>
                <div className="stat-card stagger-item" style={{animationDelay: '100ms'}}><h3 className="stat-title">Pending Approvals</h3><p className="stat-value">{pendingApprovals.length}</p></div>
                <div className="stat-card stagger-item" style={{animationDelay: '200ms'}}><h3 className="stat-title">Locked Accounts</h3><p className="stat-value">{lockedUsers}</p></div>
                <div className="stat-card stagger-item" style={{animationDelay: '300ms'}}><h3 className="stat-title">Active Security Alerts</h3><p className="stat-value">{activeAlerts.length}</p></div>
            </div>
            <div className="dashboard-grid">
                <div className="dashboard-card">
                    <h3>Recent Audit Log</h3>
                    <div className="feed-list">
                        {MOCK_AUDIT_LOGS.slice(0, 5).map(log => (
                            <div key={log.id} className="feed-item-card">
                                <div className={`feed-item-icon`}>
                                    {log.status === 'success' ? <Icons.check/> : log.status === 'failure' ? <Icons.xmark/> : <Icons.info/>}
                                </div>
                                <div>
                                    <p className="feed-item-title">{log.action}</p>
                                    <p className="feed-item-meta">by {log.userName} from {log.ip}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="dashboard-card">
                    <h3>Active Security Alerts</h3>
                    <div className="feed-list">
                        {activeAlerts.length > 0 ? activeAlerts.slice(0, 5).map(alert => (
                            <div key={alert.id} className="feed-item-card">
                                <div className={`feed-item-icon severity-icon severity-${alert.severity}`}><Icons.warning/></div>
                                <div>
                                    <p className="feed-item-title">{alert.title}</p>
                                    <p className="feed-item-meta">{alert.description}</p>
                                </div>
                            </div>
                        )) : <p>No active security alerts.</p>}
                        {activeAlerts.length > 0 && <button className="btn-link" onClick={() => setCurrentView('security')}>Go to Security</button>}
                    </div>
                </div>
            </div>
        </div>
    );
}

const AIStudyPlanGenerator = () => {
    const [subject, setSubject] = useState('');
    const [duration, setDuration] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [generatedPlan, setGeneratedPlan] = useState<StudyPlan | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const { addNotification } = useContext(AppContext);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isAiEnabled || !ai) {
            addNotification("AI features are disabled. Please configure the API key.", 'error');
            return;
        }
        if (!subject || !duration) {
            addNotification("Please enter both subject and duration.", "warning");
            return;
        }
        setIsLoading(true);
        try {
            const prompt = `Generate a detailed weekly and daily study plan for a student to learn "${subject}" over a period of "${duration}". The plan should cover all essential topics. For each day, list the main topic and a few specific, actionable learning tasks as a checklist.`;
            
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            title: { type: Type.STRING, description: `A concise title, like 'Study Plan for ${subject}'` },
                            weeks: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        week: { type: Type.INTEGER },
                                        days: {
                                            type: Type.ARRAY,
                                            items: {
                                                type: Type.OBJECT,
                                                properties: {
                                                    day: { type: Type.STRING, description: "e.g., Monday, Tuesday" },
                                                    topic: { type: Type.STRING, description: "Main topic for the day." },
                                                    tasks: {
                                                        type: Type.ARRAY,
                                                        items: {
                                                            type: Type.OBJECT,
                                                            properties: {
                                                                text: { type: Type.STRING, description: "A specific learning task." },
                                                                completed: { type: Type.BOOLEAN, default: false }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            });

            const planData = JSON.parse(response.text) as StudyPlan;
            setGeneratedPlan(planData);
            setIsModalOpen(true);
            addNotification("Study plan generated successfully!", "success");
        } catch (error) {
            console.error("Error generating study plan:", error);
            addNotification("Failed to generate study plan. Please try again.", "error");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <>
            <div className="ai-feature-card-header">
                <Icons.sparkles />
                <h3>AI Study Plan Generator</h3>
            </div>
            <p>Enter a subject and a timeframe, and let AI create a personalized study schedule for you.</p>
            <form className="ai-generator-form" onSubmit={handleSubmit}>
                <input type="text" className="form-control" placeholder="e.g., Data Structures" value={subject} onChange={e => setSubject(e.target.value)} disabled={isLoading} />
                <input type="text" className="form-control" placeholder="e.g., 4 Weeks" value={duration} onChange={e => setDuration(e.target.value)} disabled={isLoading} />
                <button type="submit" className="btn btn-primary" disabled={isLoading}>
                    {isLoading ? <span className="spinner"></span> : 'Generate Plan'}
                </button>
            </form>
            {isModalOpen && generatedPlan && (
                <StudyPlanModal plan={generatedPlan} setPlan={setGeneratedPlan} onClose={() => setIsModalOpen(false)} />
            )}
        </>
    );
};

const TimetableView = () => {
    const { timetable, currentUser, settings } = useContext(AppContext);
    const [filters, setFilters] = useState({ dept: currentUser.dept, year: currentUser.role === 'student' ? currentUser.year : 'II' });
    const [selectedEntry, setSelectedEntry] = useState<TimetableEntry | null>(null);
    const [isModalOpen, setModalOpen] = useState(false);

    const handleFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setFilters({ ...filters, [e.target.name]: e.target.value });
    };

    const filteredTimetable = useMemo(() => {
        return timetable.filter(entry => entry.department === filters.dept && entry.year === filters.year);
    }, [timetable, filters]);

    const canEdit = ['hod', 'admin', 'principal', 'creator'].includes(currentUser.role);

    const handleCellClick = (day: string, timeIndex: number) => {
        if (!canEdit) return;
        const entry = filteredTimetable.find(e => e.day === day && e.timeIndex === timeIndex);
        setSelectedEntry(entry || {
            id: `tt_${day}_${timeIndex}_${filters.dept}_${filters.year}`,
            day, timeIndex,
            department: filters.dept,
            year: filters.year,
            subject: '',
            type: 'class'
        });
        setModalOpen(true);
    };

    const handleModalClose = () => {
        setModalOpen(false);
        setSelectedEntry(null);
    };

    return (
        <div className="timetable-container">
            <div className="timetable-header">
                <h3>Class Schedule</h3>
                <div className="timetable-controls">
                     <div className="control-group-inline">
                        <label htmlFor="dept">Department:</label>
                        <select id="dept" name="dept" value={filters.dept} onChange={handleFilterChange} className="form-control">
                           {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                    </div>
                     <div className="control-group-inline">
                        <label htmlFor="year">Year:</label>
                         <select id="year" name="year" value={filters.year} onChange={handleFilterChange} className="form-control">
                            <option value="I">I</option>
                            <option value="II">II</option>
                            <option value="III">III</option>
                            <option value="IV">IV</option>
                        </select>
                    </div>
                </div>
            </div>

            <div className="timetable-wrapper">
                <div className="timetable-grid" style={{ gridTemplateRows: `40px repeat(${settings.timeSlots.length}, 60px)`}}>
                    <div className="grid-header">Time</div>
                    {DAYS.map(day => <div key={day} className="grid-header">{day}</div>)}

                    {settings.timeSlots.map((slot, timeIndex) => (
                        <React.Fragment key={timeIndex}>
                            <div className="time-slot">{slot}</div>
                            {DAYS.map((day) => {
                                const entry = filteredTimetable.find(e => e.day === day && e.timeIndex === timeIndex);
                                return (
                                    <div 
                                        key={`${day}-${timeIndex}`} 
                                        className={`grid-cell ${entry?.type || ''} ${canEdit ? 'editable' : ''}`}
                                        onClick={() => handleCellClick(day, timeIndex)}
                                    >
                                        {entry && (
                                            <>
                                                <span className="subject">{entry.subject}</span>
                                                {entry.faculty && <span className="faculty">{entry.faculty}</span>}
                                                {entry.room && <span className="faculty">Room: {entry.room}</span>}
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                        </React.Fragment>
                    ))}
                </div>
            </div>
             {isModalOpen && selectedEntry && (
                <TimetableEntryModal entry={selectedEntry} onClose={handleModalClose} />
            )}
        </div>
    );
};


const AnnouncementsView = () => {
    const { announcements, setAnnouncements, currentUser, addNotification } = useContext(AppContext);
    const [editingAnn, setEditingAnn] = useState<Announcement | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<Announcement | null>(null);

    const handleReaction = (announcementId: string, emoji: string) => {
        setAnnouncements((prevAnnouncements: Announcement[]) =>
            prevAnnouncements.map(ann => {
                if (ann.id === announcementId) {
                    const reactions = { ...(ann.reactions || {}) };
                    if (!reactions[emoji]) reactions[emoji] = [];

                    const userIndex = reactions[emoji].indexOf(currentUser.id);
                    if (userIndex > -1) {
                        reactions[emoji].splice(userIndex, 1);
                        if (reactions[emoji].length === 0) delete reactions[emoji];
                    } else {
                        reactions[emoji].push(currentUser.id);
                    }
                    return { ...ann, reactions };
                }
                return ann;
            })
        );
    };
    
    const handleDelete = () => {
        if (!confirmDelete) return;
        setAnnouncements((prev: Announcement[]) => prev.filter(ann => ann.id !== confirmDelete.id));
        addNotification('Announcement deleted.', 'success');
        setConfirmDelete(null);
    };

    const canPost = ['admin', 'hod', 'principal', 'creator'].includes(currentUser.role);
    const sortedAnnouncements = [...announcements].sort((a, b) => b.timestamp - a.timestamp);

    return (
        <div>
            <div className="view-header">
                <h2>Latest News & Updates</h2>
                {canPost && <button className="btn btn-primary" onClick={() => setEditingAnn({} as Announcement)}>New Announcement</button>}
            </div>
            <div className="announcement-list">
                {sortedAnnouncements.map(ann => {
                    const canManage = ann.authorId === currentUser.id || ['admin', 'hod', 'principal', 'creator'].includes(currentUser.role);
                    return (
                    <div key={ann.id} className="announcement-card stagger-item">
                        {canManage && (
                            <div className="card-actions">
                                <button onClick={() => setEditingAnn(ann)} aria-label="Edit announcement"><Icons.edit/></button>
                                <button onClick={() => setConfirmDelete(ann)} aria-label="Delete announcement"><Icons.trash/></button>
                            </div>
                        )}
                        <h3>{ann.title}</h3>
                        <p>{ann.content}</p>
                        <div className="announcement-footer">
                            <div className="meta">
                                <strong>{ann.author}</strong> - {formatDate(ann.timestamp)}
                            </div>
                            <div className="reactions">
                                {['👍', '❤️', '🎉'].map(emoji => (
                                    <button
                                        key={emoji}
                                        className={ann.reactions?.[emoji]?.includes(currentUser.id) ? 'active' : ''}
                                        onClick={() => handleReaction(ann.id, emoji)}
                                    >
                                        {emoji} {ann.reactions?.[emoji]?.length || 0}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )})}
            </div>
            {editingAnn && <AnnouncementModal announcement={editingAnn.id ? editingAnn : null} onClose={() => setEditingAnn(null)} />}
            {confirmDelete && (
                <ConfirmModal
                    title="Delete Announcement"
                    message="Are you sure you want to delete this announcement? This action cannot be undone."
                    onConfirm={handleDelete}
                    onCancel={() => setConfirmDelete(null)}
                />
            )}
        </div>
    );
};

const UserManagementView = () => {
    const { users, setUsers } = useContext(AppContext);
    const [filter, setFilter] = useState<'all' | 'pending_approval' | 'active' | 'rejected'>('all');
    const [isModalOpen, setModalOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState<User | null>(null);

    const handleEditUser = (user: User) => {
        setSelectedUser(user);
        setModalOpen(true);
    };

    const handleApprove = (userId: string, status: 'active' | 'rejected') => {
        setUsers(users.map(u => u.id === userId ? { ...u, status } : u));
    };

    const handleToggleLock = (userId: string) => {
        setUsers(users.map(u => u.id === userId ? { ...u, isLocked: !u.isLocked } : u));
    };

    const filteredUsers = users.filter(user => filter === 'all' || user.status === filter);

    return (
        <div>
            <div className="view-header">
                <h2>Manage Users</h2>
                 <select value={filter} onChange={(e) => setFilter(e.target.value as any)} className="form-control" style={{width: '200px'}}>
                    <option value="all">All Users</option>
                    <option value="pending_approval">Pending Approval</option>
                    <option value="active">Active</option>
                    <option value="rejected">Rejected</option>
                </select>
            </div>
             <div className="table-wrapper">
                <table className="entry-list-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Role</th>
                            <th>Department</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                       {filteredUsers.map(user => (
                            <tr key={user.id}>
                                <td data-label="Name">{user.name}</td>
                                <td data-label="Role" style={{ textTransform: 'capitalize' }}>{user.role}</td>
                                <td data-label="Department">{user.dept}</td>
                                <td data-label="Status">
                                    <span className={`status-badge status-${user.status}`}>{user.status.replace('_', ' ')}</span>
                                     {user.isLocked && <span className="status-badge status-locked">Locked</span>}
                                </td>
                                <td data-label="Actions" className="entry-actions">
                                    {user.status === 'pending_approval' && (
                                        <>
                                            <button className="btn btn-sm btn-success" onClick={() => handleApprove(user.id, 'active')}><Icons.check/> Approve</button>
                                            <button className="btn btn-sm btn-danger" onClick={() => handleApprove(user.id, 'rejected')}><Icons.xmark/> Reject</button>
                                        </>
                                    )}
                                    <button className="btn btn-sm btn-secondary" onClick={() => handleToggleLock(user.id)}>
                                        {user.isLocked ? <Icons.unlock/> : <Icons.lock/>}
                                    </button>
                                    <button className="btn btn-sm btn-secondary" onClick={() => handleEditUser(user)}><Icons.edit/></button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {isModalOpen && <UserModal user={selectedUser} onClose={() => { setModalOpen(false); setSelectedUser(null); }} />}
        </div>
    );
};

const StudentDirectoryView = () => {
    const { users } = useContext(AppContext);
    const [filters, setFilters] = useState({ dept: 'all', year: 'all', search: '' });
    const [selectedStudent, setSelectedStudent] = useState<User | null>(null);

    const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setFilters({ ...filters, [e.target.name]: e.target.value });
    };

    const students = useMemo(() => {
        return users.filter(u => u.role === 'student')
            .filter(s => filters.dept === 'all' || s.dept === filters.dept)
            .filter(s => filters.year === 'all' || s.year === filters.year)
            .filter(s => s.name.toLowerCase().includes(filters.search.toLowerCase()));
    }, [users, filters]);

    return (
        <div className="directory-container">
            <div className="directory-filters">
                <input type="search" name="search" placeholder="Search by name..." className="form-control" onChange={handleFilterChange} />
                <select name="dept" className="form-control" onChange={handleFilterChange}>
                    <option value="all">All Departments</option>
                    {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                <select name="year" className="form-control" onChange={handleFilterChange}>
                    <option value="all">All Years</option>
                    <option value="I">I Year</option>
                    <option value="II">II Year</option>
                    <option value="III">III Year</option>
                    <option value="IV">IV Year</option>
                </select>
            </div>
            <div className="student-grid">
                {students.map(student => (
                    <div key={student.id} className="student-card" onClick={() => setSelectedStudent(student)}>
                        <div className="student-card-avatar"><Icons.userCircle /></div>
                        <div className="student-card-info">
                            <h4>{student.name}</h4>
                            <p>{student.dept} - Year {student.year}</p>
                            {student.aiRiskAnalysis && student.aiRiskAnalysis.riskLevel !== 'Low' && (
                                <span className={`status-badge status-${student.aiRiskAnalysis.riskLevel === 'High' ? 'rejected' : 'pending-approval'}`}>{student.aiRiskAnalysis.riskLevel} Risk</span>
                            )}
                        </div>
                    </div>
                ))}
            </div>
            {selectedStudent && <StudentDetailModal student={selectedStudent} onClose={() => setSelectedStudent(null)} />}
        </div>
    );
};

const CourseFilesView = () => {
    const { courseFiles, setCourseFiles, currentUser } = useContext(AppContext);
    const [selectedFile, setSelectedFile] = useState<CourseFile | null>(null);
    const [isModalOpen, setModalOpen] = useState(false);

    const canReview = ['hod', 'principal'].includes(currentUser.role);
    const canSubmit = currentUser.role === 'faculty';

    const handleReview = async (file: CourseFile) => {
        if (!isAiEnabled || !ai) return;

        setCourseFiles(files => files.map(f => f.id === file.id ? { 
            ...f, 
            aiReview: { 
                summary: '', 
                suggestions: [],
                corrections: [],
                status: 'pending', 
                timestamp: Date.now() 
            } 
        } : f));
        
        try {
            const prompt = `Review the following course file submission for quality. Subject: ${file.subject}, Semester: ${file.semester}. Files submitted: ${file.files.map(f=>f.name).join(', ')}. Provide a concise summary, a list of actionable suggestions for improvement, and identify any potential corrections in content (if any).`;
             const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                 config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            summary: { type: Type.STRING },
                            suggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
                            corrections: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        original: { type: Type.STRING },
                                        corrected: { type: Type.STRING },
                                    }
                                }
                            }
                        }
                    }
                }
            });
            const reviewData = JSON.parse(response.text);
            
            const fullReview = { ...reviewData, status: 'complete', timestamp: Date.now() };
            setCourseFiles(files => files.map(f => f.id === file.id ? { ...f, aiReview: fullReview } : f));
            setSelectedFile(prev => prev ? { ...prev, aiReview: fullReview } : null);

        } catch (error) {
            console.error("AI Review failed:", error);
            setCourseFiles(files => files.map(f => f.id === file.id ? { ...f, aiReview: { summary: 'AI review failed to generate.', suggestions: [], corrections: [], status: 'failed', timestamp: Date.now() } } : f));
        }
    };

    const visibleFiles = currentUser.role === 'faculty' ? courseFiles.filter(f => f.facultyId === currentUser.id) : courseFiles;

    return (
        <div>
             <div className="view-header">
                <h2>Course File Submissions</h2>
                {canSubmit && <button className="btn btn-primary" onClick={() => setModalOpen(true)}>Submit New Files</button>}
            </div>
             <div className="table-wrapper">
                <table className="entry-list-table">
                    <thead>
                        <tr>
                            <th>Faculty</th>
                            <th>Subject</th>
                            <th>Semester</th>
                            <th>Status</th>
                            <th>Submitted</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {visibleFiles.map(file => (
                            <tr key={file.id}>
                                <td data-label="Faculty">{file.facultyName}</td>
                                <td data-label="Subject">{file.subject}</td>
                                <td data-label="Semester">{file.semester}</td>
                                <td data-label="Status"><span className={`status-badge status-${file.status}`}>{file.status.replace('_', ' ')}</span></td>
                                <td data-label="Submitted">{formatDate(file.submittedAt)}</td>
                                <td data-label="Actions" className="entry-actions">
                                    <button className="btn btn-sm btn-secondary" onClick={() => setSelectedFile(file)}>View Details</button>
                                     {canReview && (!file.aiReview || file.aiReview.status !== 'pending') && (
                                        <button className="btn btn-sm btn-primary" onClick={() => handleReview(file)} style={{gap: '0.25rem'}}>
                                            <Icons.sparkles/> {file.aiReview ? 'Re-run' : 'AI'} Review
                                        </button>
                                    )}
                                     {canReview && file.aiReview?.status === 'pending' && <span className="spinner"></span>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
             </div>
            {selectedFile && <CourseFileDetailModal file={selectedFile} onClose={() => setSelectedFile(null)} />}
            {isModalOpen && <CourseFileSubmitModal onClose={() => setModalOpen(false)} />}
        </div>
    );
};

const ResourcesView = () => {
    const { resources, setResources, currentUser, addNotification } = useContext(AppContext);
    const [filter, setFilter] = useState<{ type: 'all' | Resource['type'], dept: 'all' | string }>({ type: 'all', dept: 'all' });
    const [editingResource, setEditingResource] = useState<Resource | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<Resource | null>(null);

    const handleFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setFilter(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleDelete = () => {
        if (!confirmDelete) return;
        setResources((prev: Resource[]) => prev.filter(res => res.id !== confirmDelete.id));
        addNotification('Resource deleted.', 'success');
        setConfirmDelete(null);
    };

    const filteredResources = resources.filter(res => 
        (filter.type === 'all' || res.type === filter.type) &&
        (filter.dept === 'all' || res.department === filter.dept || res.department === 'all')
    );
    
    const resourceIcons = { book: <Icons.book />, notes: <Icons.notes />, project: <Icons.project />, lab: <Icons.lab />, other: <Icons.other /> };
    const canUpload = ['faculty', 'hod', 'admin'].includes(currentUser.role);

    return (
         <div className="directory-container">
            <div className="view-header">
                <h2>Shared Resources</h2>
                {canUpload && <button className="btn btn-primary" onClick={() => setEditingResource({} as Resource)}>Upload Resource</button>}
            </div>
            <div className="directory-filters">
                <select name="type" className="form-control" onChange={handleFilterChange} value={filter.type}>
                    <option value="all">All Types</option>
                    <option value="book">Books</option>
                    <option value="notes">Notes</option>
                    <option value="project">Projects</option>
                    <option value="lab">Lab Materials</option>
                    <option value="other">Other</option>
                </select>
                <select name="dept" className="form-control" onChange={handleFilterChange} value={filter.dept}>
                    <option value="all">All Departments</option>
                    {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
            </div>
            <div className="resources-grid">
                {filteredResources.map((res, i) => {
                    const canManage = res.uploaderId === currentUser.id || ['admin', 'hod', 'principal'].includes(currentUser.role);
                    return (
                    <div key={res.id} className="resource-card stagger-item" style={{animationDelay: `${i * 50}ms`}}>
                         {canManage && (
                            <div className="card-actions">
                                <button onClick={() => setEditingResource(res)} aria-label="Edit resource"><Icons.edit/></button>
                                <button onClick={() => setConfirmDelete(res)} aria-label="Delete resource"><Icons.trash/></button>
                            </div>
                        )}
                        <div className="resource-card-header">
                            <div className="resource-icon">{resourceIcons[res.type]}</div>
                            <div className="resource-info">
                                <h4>{res.name}</h4>
                                <p className="resource-meta">{res.department} / {res.subject}</p>
                            </div>
                        </div>
                        <div className="resource-card-footer">
                           <p className="resource-uploader">Uploaded by {res.uploaderName} on {formatDate(res.timestamp, { year: 'numeric', month: 'short', day: 'numeric' })}</p>
                        </div>
                    </div>
                )})}
            </div>
            {editingResource && <ResourceModal resource={editingResource.id ? editingResource : null} onClose={() => setEditingResource(null)} />}
            {confirmDelete && (
                <ConfirmModal
                    title="Delete Resource"
                    message="Are you sure you want to delete this resource? This action cannot be undone."
                    onConfirm={handleDelete}
                    onCancel={() => setConfirmDelete(null)}
                />
            )}
        </div>
    );
};

const AcademicCalendarView = () => {
    const { calendarEvents, setCalendarEvents, currentUser, addNotification } = useContext(AppContext);
    const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<CalendarEvent | null>(null);

    const eventsByMonth = useMemo(() => {
        const grouped: { [key: string]: CalendarEvent[] } = {};
        const sortedEvents = [...calendarEvents].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        sortedEvents.forEach(event => {
            const month = formatDate(new Date(event.date).getTime(), { year: 'numeric', month: 'long' });
            if (!grouped[month]) {
                grouped[month] = [];
            }
            grouped[month].push(event);
        });
        return grouped;
    }, [calendarEvents]);
    
    const handleDelete = () => {
        if (!confirmDelete) return;
        setCalendarEvents((prev: CalendarEvent[]) => prev.filter(event => event.id !== confirmDelete.id));
        addNotification('Event deleted from calendar.', 'success');
        setConfirmDelete(null);
    };

    const canAddEvent = ['admin', 'principal'].includes(currentUser.role);

    return (
        <div className="calendar-container">
             <div className="view-header">
                <h2>Academic Calendar</h2>
                {canAddEvent && <button className="btn btn-primary" onClick={() => setEditingEvent({} as CalendarEvent)}>New Event</button>}
            </div>
            {Object.entries(eventsByMonth).map(([month, events]) => (
                <div key={month} className="calendar-month-group stagger-item">
                    <h3>{month}</h3>
                    <div className="calendar-event-list">
                        {events.map(event => (
                             <div key={event.id} className={`calendar-event-item ${event.type}`}>
                                <div className="event-date">
                                    <div className="date-day">{new Date(`${event.date}T00:00:00`).getDate()}</div>
                                    <div className="date-month">{formatDate(new Date(`${event.date}T00:00:00`).getTime(), { month: 'short' })}</div>
                                </div>
                                <div className="event-details">
                                    <p className="event-title">{event.title}</p>
                                </div>
                                <div className="event-actions">
                                    {canAddEvent && (
                                        <>
                                            <button onClick={() => setEditingEvent(event)} aria-label="Edit event"><Icons.edit/></button>
                                            <button onClick={() => setConfirmDelete(event)} aria-label="Delete event"><Icons.trash/></button>
                                        </>
                                    )}
                                    <span className="event-type-badge">{event.type}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
            {editingEvent && <CalendarEventModal event={editingEvent.id ? editingEvent : null} onClose={() => setEditingEvent(null)} />}
            {confirmDelete && (
                <ConfirmModal
                    title="Delete Calendar Event"
                    message="Are you sure you want to delete this event? This action cannot be undone."
                    onConfirm={handleDelete}
                    onCancel={() => setConfirmDelete(null)}
                />
            )}
        </div>
    );
};

const SecurityView = () => {
    const [view, setView] = useState<'alerts' | 'logs'>('alerts');
    const { addNotification, setUsers } = useContext(AppContext);
    const [alerts, setAlerts] = useState(MOCK_SECURITY_ALERTS);

    const handleResolve = (alertId: string) => {
        setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, isResolved: true } : a));
        addNotification('Alert marked as resolved.', 'success');
    };

    const handleAction = (alert: SecurityAlert) => {
        if (alert.relatedUserId && alert.responsePlan?.recommendedAction === 'LOCK_USER') {
            setUsers((prevUsers: User[]) => prevUsers.map(u => u.id === alert.relatedUserId ? { ...u, isLocked: true } : u));
            addNotification(`User account ${alert.relatedUserId} has been locked.`, 'warning');
            handleResolve(alert.id);
        }
    };
    
    return (
        <div className="security-container">
             <div className="control-group-inline" style={{ marginBottom: '2rem' }}>
                <button className={`btn ${view === 'alerts' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('alerts')}>Security Alerts</button>
                <button className={`btn ${view === 'logs' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('logs')}>Audit Logs</button>
            </div>
            
            {view === 'alerts' && (
                <div className="security-grid">
                    {alerts.filter(a => !a.isResolved).map(alert => (
                        <div key={alert.id} className={`alert-card severity-${alert.severity}`}>
                            <div className="alert-card-header">
                                <span className={`severity-icon severity-${alert.severity}`}>
                                    {alert.severity === 'critical' ? <Icons.critical/> : <Icons.warning/>}
                                </span>
                                <h4>{alert.title}</h4>
                            </div>
                            <p className="alert-card-description">{alert.description}</p>
                            <div className="alert-card-footer">
                                <span>{formatDate(alert.timestamp)}</span>
                                <div className="entry-actions">
                                    {alert.responsePlan?.recommendedAction !== 'NONE' && (
                                        <button className="btn btn-sm btn-warning" onClick={() => handleAction(alert)}>
                                            Take Action
                                        </button>
                                    )}
                                    <button className="btn btn-sm btn-secondary" onClick={() => handleResolve(alert.id)}>Resolve</button>
                                </div>
                            </div>
                        </div>
                    ))}
                    {alerts.filter(a => !a.isResolved).length === 0 && <p>No active security alerts.</p>}
                </div>
            )}

            {view === 'logs' && (
                <div className="table-wrapper">
                    <table className="entry-list-table audit-log-table">
                        <thead>
                            <tr>
                                <th>Timestamp</th><th>User</th><th>Action</th><th>Status</th><th>IP Address</th><th>Details</th>
                            </tr>
                        </thead>
                         <tbody>
                            {[...MOCK_AUDIT_LOGS].sort((a, b) => b.timestamp - a.timestamp).map(log => (
                                <tr key={log.id}>
                                    <td data-label="Timestamp">{formatDate(log.timestamp)}</td>
                                    <td data-label="User">{log.userName} ({log.userId})</td>
                                    <td data-label="Action">{log.action}</td>
                                    <td data-label="Status"><span className={`status-badge status-${log.status}`}>{log.status}</span></td>
                                    <td data-label="IP Address">{log.ip}</td>
                                    <td data-label="Details">{log.details || 'N/A'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

const SettingsView = () => {
    const { currentUser, setCurrentUser, users, setUsers, settings, setSettings, addNotification } = useContext(AppContext);
    
    const [profileData, setProfileData] = useState({ name: currentUser.name, password: '' });
    const [appSettings, setAppSettings] = useState({ accentColor: settings.accentColor });

    const handleProfileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setProfileData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleSettingsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setAppSettings(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleProfileSave = (e: React.FormEvent) => {
        e.preventDefault();
        const updatedUser = {
            ...currentUser,
            name: profileData.name,
            password: profileData.password ? profileData.password : currentUser.password,
        };
        setCurrentUser(updatedUser);
        setUsers(users.map((u: User) => u.id === currentUser.id ? updatedUser : u));
        addNotification('Profile updated successfully!', 'success');
        setProfileData(prev => ({...prev, password: ''}));
    };

    const handleSettingsSave = (e: React.FormEvent) => {
        e.preventDefault();
        setSettings(prev => ({ ...prev, ...appSettings }));
        addNotification('Settings saved!', 'success');
    };

    return (
        <div className="settings-container">
            <div className="settings-card">
                <h3>Profile Settings</h3>
                <form onSubmit={handleProfileSave}>
                    <div className="control-group">
                        <label htmlFor="name">Name</label>
                        <input id="name" name="name" type="text" className="form-control" value={profileData.name} onChange={handleProfileChange} />
                    </div>
                    <div className="control-group">
                        <label htmlFor="password">New Password (leave blank to keep current)</label>
                        <input id="password" name="password" type="password" className="form-control" value={profileData.password} onChange={handleProfileChange} />
                    </div>
                    <button type="submit" className="btn btn-primary">Update Profile</button>
                </form>
            </div>
             <div className="settings-card">
                <h3>Application Settings</h3>
                <form onSubmit={handleSettingsSave}>
                    <div className="control-group">
                        <label htmlFor="accentColor">Accent Color</label>
                        <input id="accentColor" name="accentColor" type="color" className="form-control" value={appSettings.accentColor} onChange={handleSettingsChange} style={{padding: '0.25rem', height: '40px'}}/>
                    </div>
                    <button type="submit" className="btn btn-primary">Save Settings</button>
                </form>
            </div>
        </div>
    );
};

const AuthView = () => {
    const { users, setUsers, setCurrentUser, addNotification } = useContext(AppContext);
    const [isLogin, setIsLogin] = useState(true);
    const [credentials, setCredentials] = useState({ id: '', password: '' });
    const [signupData, setSignupData] = useState({ name: '', id: '', password: '', role: 'student' as UserRole, dept: 'CSE', year: 'I' });

    const handleLogin = (e: React.FormEvent) => {
        e.preventDefault();
        const user = users.find(u => u.id === credentials.id && u.password === credentials.password);
        if (user) {
            if (user.isLocked) {
                 addNotification('Your account is locked. Please contact an administrator.', 'error');
                 return;
            }
             if (user.status === 'pending_approval') {
                addNotification('Your account is pending approval.', 'warning');
                return;
            }
            if (user.status === 'rejected') {
                addNotification('Your account registration was rejected.', 'error');
                return;
            }
            setCurrentUser(user);
            addNotification(`Welcome back, ${user.name}!`, 'success');
        } else {
            addNotification('Invalid credentials. Please try again.', 'error');
        }
    };
    
    const handleSignup = (e: React.FormEvent) => {
        e.preventDefault();
        if (users.find(u => u.id === signupData.id)) {
            addNotification('User ID already exists. Please choose another one.', 'error');
            return;
        }

        const newUser: User = {
            ...signupData,
            year: signupData.role === 'student' ? signupData.year : undefined,
            status: 'pending_approval',
            isLocked: false,
        };
        
        setUsers((prevUsers: User[]) => [...prevUsers, newUser]);
        addNotification('Registration request sent! An admin will review it shortly.', 'success');
        setIsLogin(true);
    };
    
    const handleCredsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setCredentials({...credentials, [e.target.name]: e.target.value});
    };
    
    const handleSignupChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setSignupData({...signupData, [e.target.name]: e.target.value});
    };
    
    return (
        <div className="login-view-container">
            <div className="login-card">
                <div className={`login-card-inner ${!isLogin ? 'is-flipped' : ''}`}>
                    <div className="login-card-front">
                        <div className="login-header">
                            <span className="logo"><Icons.logo /></span>
                            <h1>Welcome Back</h1>
                            <p>Sign in to your AcademiaAI account.</p>
                        </div>
                        <form onSubmit={handleLogin}>
                             <div className="control-group">
                                <label htmlFor="id">User ID</label>
                                <input type="text" id="id" name="id" className="form-control" required onChange={handleCredsChange} />
                            </div>
                            <div className="control-group">
                                <label htmlFor="password">Password</label>
                                <input type="password" id="password" name="password" className="form-control" required onChange={handleCredsChange} />
                            </div>
                            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }}>Login</button>
                        </form>
                         <div className="auth-hint">
                            Hint: Try <strong>admin</strong> / <strong>password</strong> or <strong>stud001</strong> / <strong>password</strong>
                        </div>
                         <div className="auth-toggle">
                            Don't have an account?
                            <button onClick={() => setIsLogin(false)}>Sign Up</button>
                        </div>
                    </div>
                    <div className="login-card-back">
                        <div className="login-header">
                            <span className="logo"><Icons.logo /></span>
                             <h1>Create Account</h1>
                            <p>Join the AcademiaAI platform.</p>
                        </div>
                         <form onSubmit={handleSignup}>
                            <div className="control-group">
                                <label>Full Name</label>
                                <input type="text" name="name" className="form-control" required onChange={handleSignupChange} />
                            </div>
                             <div className="control-group">
                                <label>User ID</label>
                                <input type="text" name="id" className="form-control" required onChange={handleSignupChange} />
                            </div>
                             <div className="control-group">
                                <label>Password</label>
                                <input type="password" name="password" className="form-control" required onChange={handleSignupChange}/>
                            </div>
                            <div className="form-grid">
                                <div className="control-group">
                                    <label>Role</label>
                                    <select name="role" className="form-control" value={signupData.role} onChange={handleSignupChange}>
                                        <option value="student">Student</option>
                                        <option value="faculty">Faculty</option>
                                    </select>
                                </div>
                                <div className="control-group">
                                    <label>Department</label>
                                    <select name="dept" className="form-control" value={signupData.dept} onChange={handleSignupChange}>
                                        {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                                    </select>
                                </div>
                            </div>
                             <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }}>Register</button>
                        </form>
                         <div className="auth-toggle">
                            Already have an account?
                            <button onClick={() => setIsLogin(true)}>Login</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};


// --- MODALS ---

const Modal = ({ children, onClose, size = 'md' }) => {
    const [isOpen, setIsOpen] = useState(false);
    const modalRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setIsOpen(true);
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const handleOverlayClick = (e: React.MouseEvent) => {
        if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
            onClose();
        }
    };
    
    return createPortal(
        <div className={`modal-overlay ${isOpen ? 'open' : ''}`} onMouseDown={handleOverlayClick}>
            <div className={`modal-content modal-${size}`} ref={modalRef}>
                {children}
            </div>
        </div>,
        document.body
    );
};

const ConfirmModal = ({ title, message, onConfirm, onCancel }: { title: string; message: string; onConfirm: () => void; onCancel: () => void; }) => {
    return (
        <Modal onClose={onCancel} size="sm">
            <div className="modal-header">
                <h3>{title}</h3>
                <button onClick={onCancel} className="close-modal-btn"><Icons.close/></button>
            </div>
            <div className="modal-body">
                <p>{message}</p>
            </div>
            <div className="modal-footer">
                <div className="actions-right">
                    <button onClick={onCancel} className="btn btn-secondary">Cancel</button>
                    <button onClick={onConfirm} className="btn btn-danger">Confirm</button>
                </div>
            </div>
        </Modal>
    );
};

const TimetableEntryModal = ({ entry, onClose }: { entry: TimetableEntry, onClose: () => void }) => {
    const { timetable, setTimetable, addNotification } = useContext(AppContext);
    const [editedEntry, setEditedEntry] = useState(entry);
    const isNew = !timetable.some(item => item.id === entry.id);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setEditedEntry(prev => ({...prev, [name]: value}));
    };
    
    const handleSave = () => {
        if (!editedEntry.subject) {
            addNotification('Subject cannot be empty.', 'warning');
            return;
        }
        setTimetable((prev: TimetableEntry[]) => {
            if (isNew) return [...prev, editedEntry];
            return prev.map(item => item.id === editedEntry.id ? editedEntry : item);
        });
        addNotification('Timetable updated!', 'success');
        onClose();
    };

    const handleDelete = () => {
        setTimetable((prev: TimetableEntry[]) => prev.filter(item => item.id !== editedEntry.id));
        addNotification('Timetable entry removed.', 'success');
        onClose();
    };

    return (
        <Modal onClose={onClose}>
            <div className="modal-header">
                <h3>{isNew ? 'Add' : 'Edit'} Timetable Entry</h3>
                <button onClick={onClose} className="close-modal-btn"><Icons.close/></button>
            </div>
            <div className="modal-body">
                <div className="control-group">
                    <label>Subject</label>
                    <input type="text" name="subject" value={editedEntry.subject} onChange={handleChange} className="form-control" />
                </div>
                <div className="control-group">
                    <label>Faculty</label>
                    <input type="text" name="faculty" value={editedEntry.faculty || ''} onChange={handleChange} className="form-control" />
                </div>
                 <div className="control-group">
                    <label>Room</label>
                    <input type="text" name="room" value={editedEntry.room || ''} onChange={handleChange} className="form-control" />
                </div>
            </div>
            <div className="modal-footer">
                {!isNew && <button onClick={handleDelete} className="btn btn-danger-outline delete-button"><Icons.trash/> Delete</button> }
                <div className="actions-right">
                    <button onClick={onClose} className="btn btn-secondary">Cancel</button>
                    <button onClick={handleSave} className="btn btn-primary">Save Changes</button>
                </div>
            </div>
        </Modal>
    );
};

const AnnouncementModal = ({ announcement, onClose }: { announcement?: Announcement | null; onClose: () => void }) => {
    const { setAnnouncements, currentUser, addNotification } = useContext(AppContext);
    const [formData, setFormData] = useState({ 
        title: announcement?.title || '', 
        content: announcement?.content || '' 
    });
    const isEditing = !!announcement;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleSave = () => {
        if (!formData.title || !formData.content) {
            addNotification('Title and content cannot be empty.', 'warning');
            return;
        }

        if (isEditing) {
            setAnnouncements((prev: Announcement[]) => 
                prev.map(ann => ann.id === announcement.id ? { ...ann, ...formData, timestamp: Date.now() } : ann)
            );
            addNotification('Announcement updated!', 'success');
        } else {
            const newAnnouncement: Announcement = {
                id: `ann_${Date.now()}`,
                ...formData,
                author: currentUser.name,
                authorId: currentUser.id,
                timestamp: Date.now(),
                targetRole: 'all',
                targetDept: 'all',
            };
            setAnnouncements((prev: Announcement[]) => [newAnnouncement, ...prev]);
            addNotification('Announcement posted!', 'success');
        }
        onClose();
    };

    return (
        <Modal onClose={onClose}>
            <div className="modal-header">
                <h3>{isEditing ? 'Edit' : 'New'} Announcement</h3>
                <button onClick={onClose} className="close-modal-btn"><Icons.close/></button>
            </div>
            <div className="modal-body">
                <div className="control-group">
                    <label>Title</label>
                    <input type="text" name="title" value={formData.title} onChange={handleChange} className="form-control" />
                </div>
                <div className="control-group">
                    <label>Content</label>
                    <textarea name="content" value={formData.content} onChange={handleChange} className="form-control" rows={5}></textarea>
                </div>
            </div>
            <div className="modal-footer">
                <div className="actions-right">
                    <button onClick={onClose} className="btn btn-secondary">Cancel</button>
                    <button onClick={handleSave} className="btn btn-primary">{isEditing ? 'Save Changes' : 'Post Announcement'}</button>
                </div>
            </div>
        </Modal>
    );
};

const UserModal = ({ user, onClose }: { user: User | null, onClose: () => void }) => {
    const { setUsers } = useContext(AppContext);
    const [editedUser, setEditedUser] = useState<User | null>(user);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        if (!editedUser) return;
        setEditedUser({ ...editedUser, [name]: value });
    };

    const handleSave = () => {
        if (!editedUser) return;
        setUsers((prev: User[]) => prev.map(u => u.id === editedUser.id ? editedUser : u));
        onClose();
    };
    
    if (!editedUser) return null;

    return (
         <Modal onClose={onClose}>
            <div className="modal-header">
                <h3>Edit User: {editedUser.name}</h3>
                <button onClick={onClose} className="close-modal-btn"><Icons.close/></button>
            </div>
            <div className="modal-body">
                <div className="control-group">
                    <label>Name</label>
                    <input type="text" name="name" value={editedUser.name} onChange={handleChange} className="form-control" />
                </div>
                <div className="control-group">
                    <label>Role</label>
                     <select name="role" value={editedUser.role} onChange={handleChange} className="form-control">
                        {USER_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                </div>
                 <div className="control-group">
                    <label>Department</label>
                     <select name="dept" value={editedUser.dept} onChange={handleChange} className="form-control">
                        {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                </div>
            </div>
            <div className="modal-footer">
                <div className="actions-right">
                    <button onClick={onClose} className="btn btn-secondary">Cancel</button>
                    <button onClick={handleSave} className="btn btn-primary">Save Changes</button>
                </div>
            </div>
        </Modal>
    );
};

const StudentDetailModal = ({ student, onClose }: { student: User, onClose: () => void }) => {
    const { setUsers, addNotification } = useContext(AppContext);
    
    const handleGenerateAnalysis = async () => {
        if (!isAiEnabled || !ai) {
             addNotification('AI features are disabled.', 'error');
             return;
        }

        const prompt = `Perform a risk analysis for student ${student.name}. Grades: ${JSON.stringify(student.grades)}. Attendance: ${JSON.stringify(student.attendance)}. Generate a risk level (Low, Moderate, High), a rationale for the assessment, and a list of recommended interventions.`;

        try {
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            riskLevel: { type: Type.STRING, enum: ['Low', 'Moderate', 'High'] },
                            rationale: { type: Type.STRING },
                            interventions: { type: Type.ARRAY, items: { type: Type.STRING } }
                        }
                    }
                }
            });
            
            const riskData = JSON.parse(response.text) as Omit<User['aiRiskAnalysis'], 'timestamp'>;
            const analysis = { ...riskData, timestamp: Date.now() };

            setUsers((prev: User[]) => prev.map(u => u.id === student.id ? { ...u, aiRiskAnalysis: analysis } : u));
            addNotification('AI Risk Analysis complete!', 'success');
        } catch (error) {
            console.error("AI Risk analysis failed:", error);
            addNotification('AI analysis failed.', 'error');
        }
    };
    
    return (
        <Modal onClose={onClose} size="lg">
            <div className="modal-header">
                <h3>Student Profile: {student.name}</h3>
                 <button onClick={onClose} className="close-modal-btn"><Icons.close/></button>
            </div>
            <div className="modal-body">
                <div className="details-list">
                    <p><strong>ID:</strong> {student.id}</p>
                    <p><strong>Department:</strong> {student.dept}</p>
                    <p><strong>Year:</strong> {student.year}</p>
                    <p><strong>Status:</strong> {student.status}</p>
                </div>

                <div className="ai-review-section">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h4>AI Risk Analysis</h4>
                        <button className="btn btn-sm btn-primary" onClick={handleGenerateAnalysis}><Icons.sparkles/> Generate/Update</button>
                    </div>
                    {student.aiRiskAnalysis ? (
                         <div className="risk-analysis-modal">
                            <div className="risk-level-display">
                                <span className={`risk-level-badge risk-level-${student.aiRiskAnalysis.riskLevel.toLowerCase()}`}>{student.aiRiskAnalysis.riskLevel} Risk</span>
                            </div>
                            <h4>Rationale</h4>
                            <p>{student.aiRiskAnalysis.rationale}</p>
                            <h4>Recommended Interventions</h4>
                            <ul>
                               {student.aiRiskAnalysis.interventions.map((item, i) => <li key={i}>{item}</li>)}
                            </ul>
                             <span className="analysis-timestamp">Last updated: {formatDate(student.aiRiskAnalysis.timestamp)}</span>
                        </div>
                    ) : <p>No AI risk analysis has been performed yet.</p>}
                </div>
            </div>
        </Modal>
    );
};

const CourseFileDetailModal = ({ file, onClose }: { file: CourseFile, onClose: () => void }) => {
    return (
        <Modal onClose={onClose} size="lg">
             <div className="modal-header">
                <h3>Course File: {file.subject}</h3>
                <button onClick={onClose} className="close-modal-btn"><Icons.close/></button>
            </div>
            <div className="modal-body">
                 <div className="details-list">
                    <p><strong>Faculty:</strong> {file.facultyName}</p>
                    <p><strong>Department:</strong> {file.department}</p>
                    <p><strong>Semester:</strong> {file.semester}</p>
                    <p><strong>Files:</strong> {file.files.map(f => f.name).join(', ')}</p>
                    <p><strong>Status:</strong> <span className={`status-badge status-${file.status}`}>{file.status.replace('_', ' ')}</span></p>
                </div>
                 <div className="ai-review-section">
                     <h4><Icons.sparkles/> AI Review</h4>
                     {file.aiReview && file.aiReview.status === 'complete' ? (
                        <div>
                           <h5>Summary</h5>
                           <p>{file.aiReview.summary}</p>
                           <h5>Suggestions</h5>
                           <ul>{file.aiReview.suggestions.map((s, i) => <li key={i}>{s}</li>)}</ul>
                        </div>
                     ) : file.aiReview?.status === 'pending' ? (
                        <p>AI Review in progress...</p>
                     ) : (
                         <p>No AI review available.</p>
                     )}
                </div>
            </div>
        </Modal>
    );
};

const CourseFileSubmitModal = ({ onClose }: { onClose: () => void }) => {
    const { setCourseFiles, currentUser, addNotification } = useContext(AppContext);
    const [formData, setFormData] = useState({ subject: '', semester: 'I', files: '' });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleSave = () => {
        if (!formData.subject || !formData.files) {
            addNotification('Please fill all fields.', 'warning');
            return;
        }
        const newSubmission: CourseFile = {
            id: `cf_${Date.now()}`,
            facultyId: currentUser.id,
            facultyName: currentUser.name,
            department: currentUser.dept,
            subject: formData.subject,
            semester: formData.semester,
            files: [{ name: formData.files, type: 'notes' }], // Simplified
            status: 'pending_review',
            submittedAt: Date.now(),
        };
        setCourseFiles((prev: CourseFile[]) => [...prev, newSubmission]);
        addNotification('Course files submitted for review!', 'success');
        onClose();
    };

    return (
        <Modal onClose={onClose}>
            <div className="modal-header"><h3>Submit Course Files</h3><button onClick={onClose} className="close-modal-btn"><Icons.close/></button></div>
            <div className="modal-body">
                <div className="control-group"><label>Subject</label><input type="text" name="subject" value={formData.subject} onChange={handleChange} className="form-control" /></div>
                <div className="control-group"><label>Semester</label><select name="semester" value={formData.semester} onChange={handleChange} className="form-control"><option>I</option><option>II</option><option>III</option><option>IV</option><option>V</option><option>VI</option><option>VII</option><option>VIII</option></select></div>
                <div className="control-group"><label>File Name (e.g., Unit1.pdf)</label><input type="text" name="files" value={formData.files} onChange={handleChange} className="form-control" /></div>
            </div>
            <div className="modal-footer"><div className="actions-right"><button onClick={onClose} className="btn btn-secondary">Cancel</button><button onClick={handleSave} className="btn btn-primary">Submit</button></div></div>
        </Modal>
    );
};

const ResourceModal = ({ resource, onClose }: { resource?: Resource | null, onClose: () => void }) => {
    const { setResources, currentUser, addNotification } = useContext(AppContext);
    const [formData, setFormData] = useState({ 
        name: resource?.name || '', 
        subject: resource?.subject || '', 
        type: resource?.type || 'notes' as Resource['type'] 
    });
    const isEditing = !!resource;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleSave = () => {
        if (!formData.name || !formData.subject) {
            addNotification('Resource name and subject cannot be empty.', 'warning');
            return;
        }
        if (isEditing) {
            setResources((prev: Resource[]) => prev.map(res => res.id === resource.id ? { ...res, ...formData, timestamp: Date.now() } : res));
            addNotification('Resource updated!', 'success');
        } else {
            const newResource: Resource = {
                id: `res_${Date.now()}`,
                ...formData,
                type: formData.type,
                department: currentUser.dept,
                uploaderId: currentUser.id,
                uploaderName: currentUser.name,
                timestamp: Date.now(),
            };
            setResources((prev: Resource[]) => [newResource, ...prev]);
            addNotification('Resource added successfully!', 'success');
        }
        onClose();
    };

    return (
        <Modal onClose={onClose}>
            <div className="modal-header"><h3>{isEditing ? 'Edit' : 'Upload New'} Resource</h3><button onClick={onClose} className="close-modal-btn"><Icons.close/></button></div>
            <div className="modal-body">
                <div className="control-group"><label>Resource Name</label><input type="text" name="name" value={formData.name} onChange={handleChange} className="form-control" /></div>
                <div className="control-group"><label>Subject</label><input type="text" name="subject" value={formData.subject} onChange={handleChange} className="form-control" /></div>
                <div className="control-group"><label>Type</label><select name="type" value={formData.type} onChange={handleChange} className="form-control"><option value="book">Book</option><option value="notes">Notes</option><option value="project">Project</option><option value="lab">Lab Material</option><option value="other">Other</option></select></div>
            </div>
            <div className="modal-footer"><div className="actions-right"><button onClick={onClose} className="btn btn-secondary">Cancel</button><button onClick={handleSave} className="btn btn-primary">{isEditing ? 'Save Changes' : 'Upload'}</button></div></div>
        </Modal>
    );
};

const CalendarEventModal = ({ event, onClose }: { event?: CalendarEvent | null; onClose: () => void }) => {
    const { setCalendarEvents, addNotification } = useContext(AppContext);
    const [formData, setFormData] = useState({ 
        title: event?.title || '', 
        date: event?.date || '', 
        type: event?.type || 'event' as CalendarEvent['type'] 
    });
    const isEditing = !!event;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleSave = () => {
        if (!formData.title || !formData.date) {
            addNotification('Event title and date are required.', 'warning');
            return;
        }

        if (isEditing) {
            setCalendarEvents((prev: CalendarEvent[]) => prev.map(ev => ev.id === event.id ? { ...ev, ...formData } : ev));
            addNotification('Calendar event updated!', 'success');
        } else {
            const newEvent: CalendarEvent = {
                id: `cal_${Date.now()}`,
                ...formData,
                type: formData.type,
            };
            setCalendarEvents((prev: CalendarEvent[]) => [...prev, newEvent]);
            addNotification('Event added to calendar!', 'success');
        }
        onClose();
    };

    return (
        <Modal onClose={onClose}>
            <div className="modal-header"><h3>{isEditing ? 'Edit' : 'Add'} Calendar Event</h3><button onClick={onClose} className="close-modal-btn"><Icons.close/></button></div>
            <div className="modal-body">
                <div className="control-group"><label>Event Title</label><input type="text" name="title" value={formData.title} onChange={handleChange} className="form-control" /></div>
                <div className="control-group"><label>Date</label><input type="date" name="date" value={formData.date} onChange={handleChange} className="form-control" /></div>
                <div className="control-group"><label>Event Type</label><select name="type" value={formData.type} onChange={handleChange} className="form-control"><option value="event">Event</option><option value="exam">Exam</option><option value="deadline">Deadline</option><option value="holiday">Holiday</option></select></div>
            </div>
            <div className="modal-footer"><div className="actions-right"><button onClick={onClose} className="btn btn-secondary">Cancel</button><button onClick={handleSave} className="btn btn-primary">{isEditing ? 'Save Changes' : 'Add Event'}</button></div></div>
        </Modal>
    );
};

const StudyPlanModal = ({ plan, setPlan, onClose }: { plan: StudyPlan, setPlan: React.Dispatch<React.SetStateAction<StudyPlan | null>>, onClose: () => void }) => {

    const toggleTask = (weekIndex: number, dayIndex: number, taskIndex: number) => {
        setPlan(currentPlan => {
            if (!currentPlan) return null;
            const newPlan = JSON.parse(JSON.stringify(currentPlan));
            newPlan.weeks[weekIndex].days[dayIndex].tasks[taskIndex].completed = !newPlan.weeks[weekIndex].days[dayIndex].tasks[taskIndex].completed;
            return newPlan;
        });
    };
    
    return (
         <Modal onClose={onClose} size="xl">
             <div className="modal-header">
                <h3>{plan.title}</h3>
                <button onClick={onClose} className="close-modal-btn"><Icons.close/></button>
            </div>
            <div className="modal-body study-plan-view">
                {plan.weeks.map((week, wIdx) => (
                    <div key={week.week} className="plan-week">
                        <h4>Week {week.week}</h4>
                        {week.days.map((day, dIdx) => (
                            <div key={`${wIdx}-${dIdx}`} className="plan-day">
                                <p className="plan-day-header">{day.day}<span>{day.topic}</span></p>
                                <ul className="plan-tasks">
                                    {day.tasks.map((task, tIdx) => (
                                        <li key={`${wIdx}-${dIdx}-${tIdx}`}>
                                            <input 
                                                type="checkbox" 
                                                id={`task-${wIdx}-${dIdx}-${tIdx}`} 
                                                checked={task.completed} 
                                                onChange={() => toggleTask(wIdx, dIdx, tIdx)} 
                                            />
                                            <label htmlFor={`task-${wIdx}-${dIdx}-${tIdx}`}>{task.text}</label>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </Modal>
    );
};

// --- CHATBOT & NOTIFICATIONS ---

const Chatbot = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const chatRef = useRef<Chat | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const { addNotification } = useContext(AppContext);

    useEffect(() => {
        if (isAiEnabled && ai && !chatRef.current) {
            chatRef.current = ai.chats.create({ model: 'gemini-2.5-flash' });
        }
    }, []);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSend = async (messageText = input) => {
        if (!messageText.trim() || isLoading) return;
        
        if (!isAiEnabled || !chatRef.current) {
            addNotification("AI Chat is not available.", 'error');
            return;
        }

        const userMessage: ChatMessage = { id: `msg_${Date.now()}`, role: 'user', text: messageText };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);

        try {
            const response = await chatRef.current.sendMessage({ message: messageText });
            const modelMessage: ChatMessage = { id: `msg_${Date.now() + 1}`, role: 'model', text: response.text };
            setMessages(prev => [...prev, modelMessage]);
        } catch (error) {
            console.error("Chat error:", error);
            const errorMessage: ChatMessage = { id: `msg_${Date.now() + 1}`, role: 'model', text: 'Sorry, I encountered an error. Please try again.', isError: true };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <>
            <button className="chatbot-fab" onClick={() => setIsOpen(!isOpen)} aria-label={isOpen ? "Close chat" : "Open chat"}>
                {isOpen ? <Icons.close /> : <Icons.sparkles />}
            </button>
            {isOpen && (
                <div className="chatbot-window">
                    <div className="chatbot-header">
                        <h3>AI Assistant</h3>
                        <button onClick={() => setIsOpen(false)}><Icons.close /></button>
                    </div>
                    <div className="chatbot-messages">
                        {messages.length === 0 && (
                            <div className="chat-empty-state">
                                <Icons.sparkles/>
                                <p>Ask me anything about the university, subjects, or schedules!</p>
                            </div>
                        )}
                        {messages.map(msg => (
                            <div key={msg.id} className={`chat-message ${msg.role} ${msg.isError ? 'error' : ''}`}>
                                <div className="chat-bubble" dangerouslySetInnerHTML={{ __html: marked.parse(msg.text) }}></div>
                            </div>
                        ))}
                         {isLoading && (
                            <div className="chat-message model">
                                <div className="chat-bubble"><span className="loading-dots"><span></span><span></span><span></span></span></div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>
                    <form className="chatbot-input-form" onSubmit={(e) => { e.preventDefault(); handleSend(); }}>
                        <input type="text" placeholder="Type a message..." value={input} onChange={(e) => setInput(e.target.value)} disabled={isLoading} />
                        <button type="submit" disabled={!input.trim() || isLoading} aria-label="Send message"><Icons.send /></button>
                    </form>
                </div>
            )}
        </>
    );
};

const notificationIcons = {
    info: <Icons.info />,
    success: <Icons.check />,
    error: <Icons.xmark />,
    warning: <Icons.warning />,
};

const NotificationContainer = ({ notifications, setNotifications }) => {
    const [exitingIds, setExitingIds] = useState<string[]>([]);

    const dismissNotification = useCallback((id: string) => {
        setExitingIds(prev => [...prev, id]);
        setTimeout(() => {
            setNotifications((prev: AppNotification[]) => prev.filter(n => n.id !== id));
            setExitingIds(prev => prev.filter(exId => exId !== id));
        }, 400); // Corresponds to CSS animation duration
    }, [setNotifications]);

    useEffect(() => {
        if (notifications.length > 0) {
            const latestNotif = notifications[notifications.length - 1];
            if (!exitingIds.includes(latestNotif.id)) {
                const timer = setTimeout(() => {
                    dismissNotification(latestNotif.id);
                }, 5000);
                return () => clearTimeout(timer);
            }
        }
    }, [notifications, exitingIds, dismissNotification]);

    return (
        <div className="notification-container">
            {notifications.map((notif: AppNotification) => (
                <div key={notif.id} className={`notification-item ${notif.type} ${exitingIds.includes(notif.id) ? 'exiting' : ''}`}>
                    <div className="notification-icon">{notificationIcons[notif.type]}</div>
                    <span>{notif.message}</span>
                    <button onClick={() => dismissNotification(notif.id)} className="notification-dismiss">&times;</button>
                    <div className="notification-progress"></div>
                </div>
            ))}
        </div>
    );
};


const root = createRoot(document.getElementById('root')!);
root.render(<App />);