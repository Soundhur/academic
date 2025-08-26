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

interface QuizQuestion {
    question: string;
    options: string[];
    correctAnswerIndex: number;
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
    { id: 'stud001', name: 'Alice', role: 'student', dept: 'CSE', year: 'II', status: 'active', grades: [{ subject: 'Data Structures', score: 85 }, { subject: 'OOPs', score: 72 }, { subject: 'Maths', score: 91 }, { subject: 'DPCO', score: 78 }], attendance: { present: 78, total: 80 }, isLocked: false, password: 'password' },
    { id: 'stud003', name: 'Eve', role: 'student', dept: 'CSE', year: 'II', status: 'active', grades: [{ subject: 'Data Structures', score: 65 }, { subject: 'OOPs', score: 55 }, { subject: 'Maths', score: 60 }, { subject: 'DPCO', score: 58 }], attendance: { present: 60, total: 80 }, isLocked: false, password: 'password', aiRiskAnalysis: { riskLevel: 'High', rationale: 'Low attendance and declining grades in core subjects.', interventions: ['Mandatory counseling session', 'Additional tutoring for OOPs'], timestamp: Date.now() - 86400000 * 3 } },
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
    { id: 'cf003', facultyId: 'fac001', facultyName: 'Prof. Charlie', department: 'CSE', subject: 'OOPs', semester: 'III', files: [{ name: 'Syllabus.pdf', type: 'syllabus' }], status: 'needs_revision', submittedAt: Date.now() - 86400000 * 10 },
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
    search: () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg>,
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
    const [auditLogs, setAuditLogs] = useLocalStorage<AuditLogEntry[]>('auditLogs', []);

    const [isSidebarOpen, setSidebarOpen] = useState(false);
    const [notifications, setNotifications] = useState<AppNotification[]>([]);
    const [isCommandBarOpen, setCommandBarOpen] = useState(false);

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
    
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setCommandBarOpen(prev => !prev);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const addNotification = useCallback((message: string, type: AppNotification['type']) => {
        const id = `notif_${Date.now()}`;
        setNotifications(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setNotifications(prev => prev.filter(n => n.id !== id));
        }, 5000);
    }, []);
    
    const addAuditLog = useCallback((action: string, status: AuditLogEntry['status'], details?: string) => {
        if (!currentUser) return;
        const newLog: AuditLogEntry = {
            id: `log_${Date.now()}`,
            timestamp: Date.now(),
            userId: currentUser.id,
            userName: currentUser.name,
            action,
            status,
            details,
            ip: "127.0.0.1" // Mock IP
        };
        setAuditLogs(prev => [newLog, ...prev].slice(0, 100)); // Keep last 100 logs
    }, [currentUser, setAuditLogs]);

    const appContextValue = {
        currentUser, setCurrentUser,
        currentView, setCurrentView,
        users, setUsers,
        announcements, setAnnouncements,
        timetable, setTimetable,
        courseFiles, setCourseFiles,
        resources, setResources,
        calendarEvents, setCalendarEvents,
        auditLogs, setAuditLogs,
        addAuditLog,
        settings, setSettings,
        addNotification,
        theme, setTheme,
        setCommandBarOpen,
    };

    if (!currentUser) {
        return (
            <AppContext.Provider value={appContextValue}>
                <AuthView />
                 <NotificationContainer notifications={notifications} setNotifications={setNotifications} />
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
            {isCommandBarOpen && <CommandBar onClose={() => setCommandBarOpen(false)} />}
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
    const { currentUser, theme, setTheme, setCommandBarOpen } = useContext(AppContext);

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
                 <button className="header-action-btn" onClick={() => setCommandBarOpen(true)} aria-label="Open command bar (Cmd+K)">
                    <Icons.search />
                </button>
                 <button className="header-action-btn" onClick={toggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
                    {theme === 'light' ? <Icons.moon /> : <Icons.sun />}
                </button>
            </div>
        </header>
    );
};

const Sidebar = ({ isSidebarOpen, setSidebarOpen }) => {
    const { currentUser, setCurrentUser, currentView, setCurrentView, addAuditLog } = useContext(AppContext);

    const handleLogout = () => {
        addAuditLog('LOGOUT', 'success');
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

const BarChart = ({ data }: { data: { label: string; value: number }[] }) => {
    const maxValue = useMemo(() => Math.max(...data.map(d => d.value), 0), [data]);

    if (!data || data.length === 0) {
        return <div className="bar-chart-container"><p>No data available.</p></div>;
    }

    return (
        <div className="bar-chart-container">
            {data.map((d, i) => (
                <div key={i} className="bar-wrapper" title={`${d.label}: ${d.value}`}>
                    <div className="bar" style={{ height: `${(d.value / (maxValue || 1)) * 100}%`, animationDelay: `${i * 50}ms` }} />
                    <span className="bar-label">{d.label}</span>
                </div>
            ))}
        </div>
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
    const gradesData = currentUser.grades?.map(g => ({ label: g.subject.substring(0, 10), value: g.score })) || [];
    
    return (
        <div className="dashboard-container">
             <h2 className="dashboard-greeting">Hello, {currentUser.name}!</h2>
             <p className="dashboard-subtitle">Here's what's happening today.</p>
             <div className="dashboard-grid">
                <div className="dashboard-card full-width ai-feature-card">
                    <AIStudyPlanGenerator />
                </div>
                <div className="dashboard-card">
                    <h3>My Grades</h3>
                    {gradesData.length > 0 ? <BarChart data={gradesData} /> : <p>No grades recorded yet.</p>}
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
    const pendingCourseFiles = courseFiles.filter(cf => cf.status === 'pending_review');
    
    const courseFileStatusData = useMemo(() => {
        const statuses = courseFiles.reduce((acc, file) => {
            acc[file.status] = (acc[file.status] || 0) + 1;
            return acc;
        }, {} as Record<CourseFile['status'], number>);
        // FIX: The value from Object.entries might be inferred as unknown in some TypeScript configurations.
        // Explicitly cast to number to match the BarChart component's prop type.
        return Object.entries(statuses).map(([label, value]) => ({ label: label.replace('_', ' '), value: value as number }));
    }, [courseFiles]);

    return (
        <div className="dashboard-container">
            <h2 className="dashboard-greeting">Management Dashboard</h2>
            <div className="dashboard-grid">
                <div className="dashboard-card">
                    <h3>Course File Submissions</h3>
                    <BarChart data={courseFileStatusData} />
                </div>
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
    const { users, auditLogs, setCurrentView } = useContext(AppContext);
    const activeAlerts = MOCK_SECURITY_ALERTS.filter(a => !a.isResolved);
    
    const userRoleData = useMemo(() => {
        const roles = users.reduce((acc, user) => {
            acc[user.role] = (acc[user.role] || 0) + 1;
            return acc;
        }, {} as Record<UserRole, number>);
        // FIX: The value from Object.entries might be inferred as unknown in some TypeScript configurations.
        // Explicitly cast to number to match the BarChart component's prop type.
        return Object.entries(roles).map(([label, value]) => ({ label, value: value as number }));
    }, [users]);

    return (
        <div className="dashboard-container">
            <h2 className="dashboard-greeting">System Administration</h2>
            <div className="dashboard-grid">
                <div className="dashboard-card full-width">
                    <h3>User Role Distribution</h3>
                    <BarChart data={userRoleData} />
                </div>
                <div className="dashboard-card">
                    <h3>Recent Audit Log</h3>
                    <div className="feed-list">
                        {auditLogs.slice(0, 5).map(log => (
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
                                    <p className="feed-item-meta">Severity: {alert.severity}</p>
                                </div>
                            </div>
                        )) : <p>No active security alerts.</p>}
                        {activeAlerts.length > 0 && <button className="btn-link" onClick={() => setCurrentView('security')}>View All Alerts</button>}
                    </div>
                </div>
            </div>
        </div>
    );
};

const TimetableView = () => {
    const { currentUser, timetable, setTimetable, settings } = useContext(AppContext);
    const [isEditing, setEditing] = useState(false);
    const [editingCell, setEditingCell] = useState<TimetableEntry | null>(null);

    const canEdit = useMemo(() => ['admin', 'hod', 'principal', 'creator'].includes(currentUser.role), [currentUser.role]);
    
    // Default to user's dept/year if student, otherwise first available
    const initialDept = currentUser.role === 'student' ? currentUser.dept : 'CSE';
    const initialYear = currentUser.role === 'student' ? currentUser.year : 'II';
    const [selectedDept, setSelectedDept] = useState(initialDept);
    const [selectedYear, setSelectedYear] = useState(initialYear);

    const filteredTimetable = useMemo(() => {
        return timetable.filter(entry => entry.department === selectedDept && entry.year === selectedYear);
    }, [timetable, selectedDept, selectedYear]);
    
    const handleCellClick = (day, timeIndex) => {
        if (!isEditing) return;
        const existingEntry = filteredTimetable.find(e => e.day === day && e.timeIndex === timeIndex);
        const newEntry: TimetableEntry = {
            id: `tt_${day.toLowerCase()}_${timeIndex}_${selectedDept}_${selectedYear}`,
            day,
            timeIndex,
            department: selectedDept,
            year: selectedYear,
            subject: 'New Class',
            type: 'class'
        };
        setEditingCell(existingEntry || newEntry);
    };
    
    const handleSave = (updatedEntry: TimetableEntry) => {
        setTimetable(prev => {
            const index = prev.findIndex(e => e.id === updatedEntry.id);
            if (index > -1) {
                const newTable = [...prev];
                newTable[index] = updatedEntry;
                return newTable;
            }
            return [...prev, updatedEntry];
        });
        setEditingCell(null);
    };
    
    const handleDelete = (id: string) => {
         setTimetable(prev => prev.filter(e => e.id !== id));
         setEditingCell(null);
    };

    return (
        <div>
            <div className="timetable-header">
                <div className="timetable-controls">
                    <div className="control-group-inline">
                        <label htmlFor="dept-select">Department</label>
                        <select id="dept-select" className="form-control" value={selectedDept} onChange={e => setSelectedDept(e.target.value)}>
                            {DEPARTMENTS.slice(0, 8).map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                    </div>
                     <div className="control-group-inline">
                        <label htmlFor="year-select">Year</label>
                        <select id="year-select" className="form-control" value={selectedYear} onChange={e => setSelectedYear(e.target.value)}>
                            {['I', 'II', 'III', 'IV'].map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                    </div>
                </div>
                {canEdit && (
                    <button className={`btn ${isEditing ? 'btn-danger-outline' : 'btn-primary'}`} onClick={() => setEditing(!isEditing)}>
                        {isEditing ? 'Cancel Edit' : 'Edit Timetable'}
                    </button>
                )}
            </div>
            
            <div className="timetable-wrapper">
                <div className="timetable-grid">
                    <div className="grid-header">Time</div>
                    {DAYS.map(day => <div key={day} className="grid-header">{day}</div>)}
                    
                    {settings.timeSlots.map((slot, timeIndex) => (
                        <React.Fragment key={timeIndex}>
                             <div className="time-slot">{slot}</div>
                             {DAYS.map(day => {
                                 const entry = filteredTimetable.find(e => e.day === day && e.timeIndex === timeIndex);
                                 return (
                                     <div key={`${day}-${timeIndex}`} className={`grid-cell ${entry?.type || ''} ${isEditing ? 'editable' : ''}`} onClick={() => handleCellClick(day, timeIndex)}>
                                         {entry ? (
                                             entry.type === 'class' ? (
                                                 <>
                                                     <span className="subject">{entry.subject}</span>
                                                     <span className="faculty">{entry.faculty} | {entry.room}</span>
                                                 </>
                                             ) : <span className="subject">{entry.subject}</span>
                                         ) : null}
                                     </div>
                                 );
                             })}
                        </React.Fragment>
                    ))}
                </div>
            </div>
            {editingCell && <TimetableEditModal entry={editingCell} onClose={() => setEditingCell(null)} onSave={handleSave} onDelete={handleDelete} />}
        </div>
    );
};

const AnnouncementsView = () => {
    const { currentUser, announcements, setAnnouncements, addAuditLog } = useContext(AppContext);
    const [isModalOpen, setModalOpen] = useState(false);
    const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
    const [isSummaryModalOpen, setSummaryModalOpen] = useState(false);
    const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);

    const handleEdit = (ann: Announcement) => {
        setEditingAnnouncement(ann);
        setModalOpen(true);
    };
    
    const handleDelete = (id: string) => {
        if(confirm('Are you sure you want to delete this announcement?')) {
            setAnnouncements(prev => prev.filter(a => a.id !== id));
            addAuditLog('DELETE_ANNOUNCEMENT', 'success', `ID: ${id}`);
        }
    };
    
    const openNewModal = () => {
        setEditingAnnouncement(null);
        setModalOpen(true);
    };

    const handleOpenSummary = (announcement: Announcement) => {
        setSelectedAnnouncement(announcement);
        setSummaryModalOpen(true);
    };

    const canManage = (announcement: Announcement) => {
        return currentUser.role === 'admin' || currentUser.id === announcement.authorId;
    };
    
    const canCreate = ['admin', 'hod', 'principal', 'faculty'].includes(currentUser.role);
    
    return (
        <div>
            <div className="view-header">
                <h2>Latest News</h2>
                {canCreate && <button className="btn btn-primary" onClick={openNewModal}>New Announcement</button>}
            </div>
            <div className="announcement-list">
                {announcements.sort((a,b) => b.timestamp - a.timestamp).map(ann => (
                    <div key={ann.id} className="announcement-card">
                         {canManage(ann) && (
                            <div className="card-actions-top">
                                <button className="btn btn-sm" onClick={() => handleEdit(ann)}><Icons.edit /></button>
                                <button className="btn btn-sm btn-danger-outline" onClick={() => handleDelete(ann.id)}><Icons.trash /></button>
                            </div>
                        )}
                        <h3>{ann.title}</h3>
                        <div className="announcement-meta">
                            <span>By <strong>{ann.author}</strong></span>
                            <span>{formatDate(ann.timestamp)}</span>
                        </div>
                        <div className="announcement-content" dangerouslySetInnerHTML={{ __html: marked(ann.content) }}></div>
                         <div className="announcement-actions">
                            <button className="btn btn-sm btn-secondary" onClick={() => handleOpenSummary(ann)}>
                                <Icons.sparkles /> AI Summary
                            </button>
                        </div>
                    </div>
                ))}
            </div>
            {isModalOpen && <AnnouncementModal announcement={editingAnnouncement} onClose={() => setModalOpen(false)} />}
            {isSummaryModalOpen && selectedAnnouncement && (
                <AnnouncementSummaryModal announcement={selectedAnnouncement} onClose={() => setSummaryModalOpen(false)} />
            )}
        </div>
    );
};


const UserManagementView = () => {
    const { users, setUsers, addAuditLog } = useContext(AppContext);
    
    const handleUserStatusChange = (userId: string, status: User['status']) => {
        setUsers(prevUsers => prevUsers.map(user => 
            user.id === userId ? { ...user, status } : user
        ));
        addAuditLog('USER_STATUS_CHANGE', 'success', `User ${userId} set to ${status}`);
    };
    
    const handleLockToggle = (userId: string, isLocked: boolean) => {
         setUsers(prevUsers => prevUsers.map(user => 
            user.id === userId ? { ...user, isLocked } : user
        ));
        addAuditLog(isLocked ? 'LOCK_USER' : 'UNLOCK_USER', 'success', `User ${userId}`);
    }

    const tabs: { name: User['status'] | 'all', label: string }[] = [
        { name: 'all', label: 'All Users' },
        { name: 'pending_approval', label: 'Pending Approvals' },
        { name: 'active', label: 'Active Users' },
        { name: 'rejected', label: 'Rejected Users' },
    ];
    const [activeTab, setActiveTab] = useState<'all' | User['status']>('all');
    
    const filteredUsers = useMemo(() => {
        if (activeTab === 'all') return users;
        return users.filter(u => u.status === activeTab);
    }, [users, activeTab]);

    return (
        <div>
            <div className="view-header">
                <h2>User Management</h2>
            </div>
            <div className="tabs">
                {tabs.map(tab => (
                    <button key={tab.name} className={`tab-btn ${activeTab === tab.name ? 'active' : ''}`} onClick={() => setActiveTab(tab.name)}>
                        {tab.label}
                    </button>
                ))}
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
                                <td>{user.name}</td>
                                <td>{user.role}</td>
                                <td>{user.dept}</td>
                                <td><span className={`status-badge status-${user.status}`}>{user.status.replace('_', ' ')}</span></td>
                                <td className="entry-actions">
                                    {user.status === 'pending_approval' && (
                                        <>
                                            <button className="btn btn-sm btn-success" onClick={() => handleUserStatusChange(user.id, 'active')}>Approve</button>
                                            <button className="btn btn-sm btn-danger" onClick={() => handleUserStatusChange(user.id, 'rejected')}>Reject</button>
                                        </>
                                    )}
                                    {user.status === 'active' && (
                                        <button className="btn btn-sm" onClick={() => handleLockToggle(user.id, !user.isLocked)}>
                                            {user.isLocked ? <><Icons.unlock /> Unlock</> : <><Icons.lock/> Lock</>}
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const StudentDirectoryView = () => {
    const { users, setUsers, addNotification } = useContext(AppContext);
    const [loadingAnalysis, setLoadingAnalysis] = useState<string | null>(null);

    const students = useMemo(() => users.filter(u => u.role === 'student'), [users]);
    
    const handleGenerateRiskAnalysis = async (studentId: string) => {
        if (!ai) {
            addNotification("AI Service not available.", "error");
            return;
        }
        
        const student = users.find(u => u.id === studentId);
        if (!student) return;
        
        setLoadingAnalysis(studentId);
        
        const prompt = `Analyze the academic risk for the following student. Provide a risk level (Low, Moderate, High), a brief rationale, and 2-3 specific intervention suggestions. Student data: Grades: ${JSON.stringify(student.grades)}, Attendance: ${student.attendance?.present}/${student.attendance?.total} classes.`;
        
        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            riskLevel: { type: Type.STRING, description: "Low, Moderate, or High" },
                            rationale: { type: Type.STRING },
                            interventions: { type: Type.ARRAY, items: { type: Type.STRING } }
                        }
                    }
                }
            });
            const analysisResult = JSON.parse(response.text);
            
            const newAnalysis = {
                ...analysisResult,
                timestamp: Date.now()
            };

            setUsers(prev => prev.map(u => u.id === studentId ? {...u, aiRiskAnalysis: newAnalysis} : u));
            addNotification(`Successfully updated risk analysis for ${student.name}.`, 'success');

        } catch (err) {
            console.error(err);
            addNotification("Failed to generate AI risk analysis.", "error");
        } finally {
            setLoadingAnalysis(null);
        }
    };

    return (
        <div>
            <div className="view-header">
                <h2>Student Directory</h2>
            </div>
            <div className="table-wrapper">
                <table className="entry-list-table">
                     <thead>
                        <tr>
                            <th>Name</th>
                            <th>Department</th>
                            <th>Year</th>
                            <th>Risk Level</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {students.map(student => (
                            <tr key={student.id}>
                                <td>{student.name}</td>
                                <td>{student.dept}</td>
                                <td>{student.year}</td>
                                <td>
                                    {student.aiRiskAnalysis ? (
                                         <span className={`status-badge status-${student.aiRiskAnalysis.riskLevel.toLowerCase()}`}>{student.aiRiskAnalysis.riskLevel}</span>
                                    ) : (
                                        <span className="text-secondary">N/A</span>
                                    )}
                                </td>
                                 <td className="entry-actions">
                                    <button className="btn btn-sm" onClick={() => handleGenerateRiskAnalysis(student.id)} disabled={loadingAnalysis === student.id}>
                                        {loadingAnalysis === student.id ? <span className="spinner"/> : <Icons.sparkles />}
                                        {student.aiRiskAnalysis ? 'Update Analysis' : 'Generate Analysis'}
                                    </button>
                                 </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};


const CourseFilesView = () => {
    const { currentUser, courseFiles, setCourseFiles, addNotification } = useContext(AppContext);
    const [isReviewModalOpen, setReviewModalOpen] = useState(false);
    const [selectedFile, setSelectedFile] = useState<CourseFile | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const canReview = ['hod', 'principal'].includes(currentUser.role);
    const filteredFiles = useMemo(() => {
        if (canReview) return courseFiles;
        return courseFiles.filter(cf => cf.facultyId === currentUser.id);
    }, [currentUser, courseFiles, canReview]);

    const handleGenerateReview = async (file: CourseFile) => {
        if (!ai) {
            addNotification("AI Service not available.", "error");
            return;
        }
        
        setIsLoading(true);
        setSelectedFile(file);

        const prompt = `As an academic reviewer, analyze this course file submission. Subject: "${file.subject}", Faculty: ${file.facultyName}. Files submitted: ${file.files.map(f => f.name).join(', ')}. Provide a brief summary, a list of actionable suggestions for improvement, and identify any potential corrections in a "original" vs "corrected" format.`;

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    responseMimeType: 'application/json',
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
                                        corrected: { type: Type.STRING }
                                    }
                                }
                            }
                        }
                    }
                }
            });
            const reviewData = JSON.parse(response.text);
            const newReview = {
                ...reviewData,
                status: 'complete',
                timestamp: Date.now(),
            };
            setCourseFiles(prev => prev.map(cf => cf.id === file.id ? {...cf, aiReview: newReview} : cf));
            addNotification(`AI Review generated for ${file.subject}`, 'success');
        } catch (err) {
            console.error(err);
            addNotification("Failed to generate AI review.", "error");
        } finally {
            setIsLoading(false);
            // Re-fetch the file to open the modal with new data
            const updatedFile = courseFiles.find(cf => cf.id === file.id);
            if(updatedFile && updatedFile.aiReview){
                setSelectedFile(updatedFile);
                setReviewModalOpen(true);
            }
        }
    };
    
    const openReviewModal = (file: CourseFile) => {
        if (file.aiReview) {
            setSelectedFile(file);
            setReviewModalOpen(true);
        } else {
            handleGenerateReview(file);
        }
    }

    return (
        <div>
            <div className="view-header"><h2>Course File Management</h2></div>
            <div className="table-wrapper">
                <table className="entry-list-table">
                    <thead>
                        <tr>
                            <th>Subject</th>
                            <th>Faculty</th>
                            <th>Submitted On</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredFiles.map(file => (
                            <tr key={file.id}>
                                <td>{file.subject} ({file.semester} Sem)</td>
                                <td>{file.facultyName}</td>
                                <td>{formatDate(file.submittedAt, { year: 'numeric', month: 'short', day: 'numeric' })}</td>
                                <td><span className={`status-badge status-${file.status}`}>{file.status.replace('_', ' ')}</span></td>
                                <td className="entry-actions">
                                    {canReview && (
                                        <button className="btn btn-sm" onClick={() => openReviewModal(file)} disabled={isLoading && selectedFile?.id === file.id}>
                                            {(isLoading && selectedFile?.id === file.id) ? <span className="spinner" /> : <Icons.sparkles />}
                                            {file.aiReview ? 'View AI Review' : 'Generate AI Review'}
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {isReviewModalOpen && selectedFile && (
                <CourseFileReviewModal file={selectedFile} onClose={() => setReviewModalOpen(false)} />
            )}
        </div>
    );
};

const ResourcesView = () => {
    const { resources } = useContext(AppContext);
    const [isSummaryModalOpen, setSummaryModalOpen] = useState(false);
    const [isQuizModalOpen, setQuizModalOpen] = useState(false);
    const [selectedResource, setSelectedResource] = useState<Resource | null>(null);

    const handleOpenSummary = (resource: Resource) => {
        setSelectedResource(resource);
        setSummaryModalOpen(true);
    };

    const handleOpenQuiz = (resource: Resource) => {
        setSelectedResource(resource);
        setQuizModalOpen(true);
    };

    const resourceIcons = {
        book: <Icons.book />,
        notes: <Icons.notes />,
        project: <Icons.project />,
        lab: <Icons.lab />,
        other: <Icons.other />,
    };

    return (
        <div>
            <div className="view-header">
                <h2>Learning Resources</h2>
            </div>
            <div className="card-grid">
                {resources.map(res => (
                    <div key={res.id} className="resource-card">
                        <div className="resource-card-icon">{resourceIcons[res.type]}</div>
                        <h3 className="resource-card-title">{res.name}</h3>
                        <p className="resource-card-meta">{res.department} | {res.subject}</p>
                        <p className="resource-card-uploader">Uploaded by {res.uploaderName}</p>
                        <div className="resource-card-actions">
                             <button className="btn btn-sm btn-secondary" onClick={() => handleOpenSummary(res)}>
                                <Icons.sparkles /> AI Summary
                            </button>
                            <button className="btn btn-sm btn-secondary" onClick={() => handleOpenQuiz(res)}>
                                <Icons.sparkles /> Generate Quiz
                            </button>
                        </div>
                    </div>
                ))}
            </div>
            {isSummaryModalOpen && selectedResource && (
                <ResourceSummaryModal resource={selectedResource} onClose={() => setSummaryModalOpen(false)} />
            )}
            {isQuizModalOpen && selectedResource && (
                <QuizGeneratorModal resource={selectedResource} onClose={() => setQuizModalOpen(false)} />
            )}
        </div>
    );
};

const AcademicCalendarView = () => {
    return <div className="placeholder-view">Academic Calendar View - To be implemented</div>;
};

const SecurityView = () => {
    const { auditLogs } = useContext(AppContext);

    return (
        <div>
            <div className="view-header">
                <h2>Security & Audit</h2>
            </div>
            <div className="dashboard-card" style={{ marginBottom: '2rem' }}>
                <h3>Active Security Alerts</h3>
                <div className="table-wrapper">
                    <table className="entry-list-table">
                        <thead>
                            <tr>
                                <th>Severity</th>
                                <th>Title</th>
                                <th>Description</th>
                                <th>Timestamp</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {MOCK_SECURITY_ALERTS.filter(a => !a.isResolved).map(alert => (
                                <tr key={alert.id}>
                                    <td><span className={`status-badge status-${alert.severity}`}>{alert.severity}</span></td>
                                    <td>{alert.title}</td>
                                    <td>{alert.description}</td>
                                    <td>{formatDate(alert.timestamp)}</td>
                                    <td><button className="btn btn-sm btn-secondary">Resolve</button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="dashboard-card">
                <h3>Live Audit Log</h3>
                <div className="table-wrapper">
                    <table className="entry-list-table">
                        <thead>
                            <tr>
                                <th>Timestamp</th>
                                <th>User</th>
                                <th>Action</th>
                                <th>Status</th>
                                <th>Details</th>
                            </tr>
                        </thead>
                        <tbody>
                            {auditLogs.map(log => (
                                <tr key={log.id}>
                                    <td>{formatDate(log.timestamp)}</td>
                                    <td>{log.userName} ({log.userId})</td>
                                    <td>{log.action}</td>
                                    <td><span className={`status-badge status-${log.status}`}>{log.status}</span></td>
                                    <td>{log.details || 'N/A'}</td>
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
    return <div className="placeholder-view">Settings View - To be implemented</div>;
};

// --- MODALS ---

const TimetableEditModal = ({ entry, onClose, onSave, onDelete }) => {
    const [formData, setFormData] = useState(entry);
    
    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };
    
    const handleSubmit = (e) => {
        e.preventDefault();
        onSave(formData);
    };

    return createPortal(
        <div className="modal-overlay">
            <div className="modal-content">
                <div className="modal-header">
                    <h3>Edit Timetable Slot</h3>
                    <button onClick={onClose} className="modal-close-btn"><Icons.close /></button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className="modal-body">
                        {/* Form fields for subject, faculty, room etc. */}
                         <div className="control-group">
                            <label>Subject</label>
                            <input type="text" name="subject" value={formData.subject} onChange={handleChange} className="form-control" />
                        </div>
                        <div className="control-group">
                            <label>Faculty</label>
                            <input type="text" name="faculty" value={formData.faculty || ''} onChange={handleChange} className="form-control" />
                        </div>
                        <div className="control-group">
                            <label>Room No.</label>
                            <input type="text" name="room" value={formData.room || ''} onChange={handleChange} className="form-control" />
                        </div>
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="btn btn-danger-outline" onClick={() => onDelete(entry.id)}>Delete</button>
                        <div>
                             <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
                             <button type="submit" className="btn btn-primary">Save Changes</button>
                        </div>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    );
};

const AnnouncementModal = ({ announcement, onClose }) => {
    const { currentUser, setAnnouncements, addAuditLog } = useContext(AppContext);
    const [title, setTitle] = useState(announcement?.title || '');
    const [content, setContent] = useState(announcement?.content || '');
    const [aiPrompt, setAiPrompt] = useState('');
    const [isAiLoading, setAiLoading] = useState(false);

    const handleSubmit = (e) => {
        e.preventDefault();
        const newAnnouncement: Announcement = {
            id: announcement?.id || `ann_${Date.now()}`,
            title,
            content,
            author: currentUser.name,
            authorId: currentUser.id,
            timestamp: Date.now(),
            targetRole: 'all', // Simplified for now
            targetDept: 'all',
        };
        
        if (announcement) {
            setAnnouncements(prev => prev.map(a => a.id === announcement.id ? newAnnouncement : a));
            addAuditLog('EDIT_ANNOUNCEMENT', 'success', `ID: ${newAnnouncement.id}`);
        } else {
            setAnnouncements(prev => [newAnnouncement, ...prev]);
            addAuditLog('CREATE_ANNOUNCEMENT', 'success', `ID: ${newAnnouncement.id}`);
        }
        onClose();
    };

    const handleGenerateWithAi = async () => {
        if (!ai || !aiPrompt) return;
        setAiLoading(true);
        const prompt = `Generate a college announcement. Create a concise title and a detailed body (in Markdown). The user's request is: "${aiPrompt}".`;
        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            title: { type: Type.STRING },
                            content: { type: Type.STRING, description: "Content in Markdown format" }
                        }
                    }
                }
            });
            const result = JSON.parse(response.text);
            setTitle(result.title);
            setContent(result.content);
        } catch (err) {
            console.error("AI Generation Error:", err);
            // Add user feedback here
        } finally {
            setAiLoading(false);
        }
    };
    
    return createPortal(
        <div className="modal-overlay">
            <div className="modal-content large">
                <form onSubmit={handleSubmit}>
                    <div className="modal-header">
                        <h3>{announcement ? 'Edit' : 'New'} Announcement</h3>
                        <button type="button" onClick={onClose} className="modal-close-btn"><Icons.close /></button>
                    </div>
                    <div className="modal-body">
                         <div className="ai-generator-section">
                             <h4><Icons.sparkles /> Generate with AI</h4>
                             <div className="ai-generator-form">
                                <input 
                                    type="text" 
                                    className="form-control"
                                    placeholder="e.g., Guest lecture on AI by Dr. Smith on Friday at 2pm"
                                    value={aiPrompt}
                                    onChange={(e) => setAiPrompt(e.target.value)}
                                    disabled={isAiLoading}
                                />
                                <button type="button" className="btn" onClick={handleGenerateWithAi} disabled={isAiLoading}>
                                    {isAiLoading ? <span className="spinner" /> : 'Generate'}
                                </button>
                             </div>
                         </div>
                        <div className="control-group">
                            <label htmlFor="ann-title">Title</label>
                            <input id="ann-title" type="text" className="form-control" value={title} onChange={e => setTitle(e.target.value)} required />
                        </div>
                        <div className="control-group">
                            <label htmlFor="ann-content">Content (Markdown supported)</label>
                            <textarea id="ann-content" className="form-control" value={content} onChange={e => setContent(e.target.value)} rows={10} required></textarea>
                        </div>
                    </div>
                    <div className="modal-footer">
                         <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
                         <button type="submit" className="btn btn-primary">Save Announcement</button>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    );
};

const ResourceSummaryModal = ({ resource, onClose }) => {
    const [summary, setSummary] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchSummary = async () => {
            if (!ai) {
                setSummary("AI functionality is disabled.");
                setIsLoading(false);
                return;
            }
            try {
                const prompt = `Provide a concise, one-paragraph summary for a learning resource titled "${resource.name}" covering the subject "${resource.subject}".`;
                const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
                setSummary(response.text);
            } catch (err) {
                console.error(err);
                setSummary("Could not generate summary at this time.");
            } finally {
                setIsLoading(false);
            }
        };
        fetchSummary();
    }, [resource]);
    
     return createPortal(
        <div className="modal-overlay">
            <div className="modal-content">
                <div className="modal-header">
                    <h3><Icons.sparkles /> AI Summary: {resource.name}</h3>
                    <button onClick={onClose} className="modal-close-btn"><Icons.close /></button>
                </div>
                <div className="modal-body">
                    {isLoading ? <div className="spinner-container"><div className="spinner" /></div> : <p>{summary}</p>}
                </div>
            </div>
        </div>,
        document.body
    );
};

const AnnouncementSummaryModal = ({ announcement, onClose }) => {
    const [summary, setSummary] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchSummary = async () => {
            if (!ai) {
                setSummary("AI functionality is disabled.");
                setIsLoading(false);
                return;
            }
            try {
                const prompt = `Provide a concise, one-paragraph summary for the following announcement titled "${announcement.title}". Content: ${announcement.content}`;
                const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
                setSummary(response.text);
            } catch (err) {
                console.error(err);
                setSummary("Could not generate summary at this time.");
            } finally {
                setIsLoading(false);
            }
        };
        fetchSummary();
    }, [announcement]);
    
     return createPortal(
        <div className="modal-overlay">
            <div className="modal-content">
                <div className="modal-header">
                    <h3><Icons.sparkles /> AI Summary: {announcement.title}</h3>
                    <button onClick={onClose} className="modal-close-btn"><Icons.close /></button>
                </div>
                <div className="modal-body">
                    {isLoading ? <div className="spinner-container"><div className="spinner" /></div> : <p>{summary}</p>}
                </div>
            </div>
        </div>,
        document.body
    );
};


const QuizGeneratorModal = ({ resource, onClose }) => {
    const [questions, setQuestions] = useState<QuizQuestion[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [userAnswers, setUserAnswers] = useState<(number | undefined)[]>([]);
    const [isFinished, setIsFinished] = useState(false);
    const [feedback, setFeedback] = useState<Record<number, string>>({});
    const [isFeedbackLoading, setIsFeedbackLoading] = useState(false);
    const { addNotification } = useContext(AppContext);

    useEffect(() => {
        const generateQuiz = async () => {
            if (!ai) {
                addNotification("AI features are disabled.", "error");
                setIsLoading(false);
                return;
            }
            try {
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: `Generate a 5-question multiple-choice quiz about "${resource.name}" on the subject of "${resource.subject}". Ensure each question has 4 options and indicate the correct answer's index.`,
                    config: {
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: Type.OBJECT,
                            properties: {
                                quiz: {
                                    type: Type.ARRAY,
                                    items: {
                                        type: Type.OBJECT,
                                        properties: {
                                            question: { type: Type.STRING },
                                            options: { type: Type.ARRAY, items: { type: Type.STRING } },
                                            correctAnswerIndex: { type: Type.INTEGER }
                                        }
                                    }
                                }
                            }
                        }
                    }
                });
                const parsed = JSON.parse(response.text);

                if (parsed.quiz && Array.isArray(parsed.quiz) && parsed.quiz.length > 0) {
                     setQuestions(parsed.quiz);
                     setUserAnswers(new Array(parsed.quiz.length).fill(undefined));
                } else {
                     throw new Error("Invalid quiz format received from AI.");
                }

            } catch (err) {
                console.error(err);
                addNotification("Failed to generate quiz.", "error");
                onClose();
            } finally {
                setIsLoading(false);
            }
        };
        generateQuiz();
    }, [resource, addNotification, onClose]);

    const handleAnswer = (optionIndex: number) => {
        const newAnswers = [...userAnswers];
        newAnswers[currentQuestionIndex] = optionIndex;
        setUserAnswers(newAnswers);

        setTimeout(() => {
            if (currentQuestionIndex < questions.length - 1) {
                setCurrentQuestionIndex(prev => prev + 1);
            } else {
                setIsFinished(true);
            }
        }, 500);
    };

    const score = useMemo(() => {
        return userAnswers.reduce((correctCount, answer, index) => {
            if (questions[index] && answer === questions[index].correctAnswerIndex) {
                return correctCount + 1;
            }
            return correctCount;
        }, 0);
    }, [userAnswers, questions]);
    
    const handleGetFeedback = async () => {
        if (!ai) {
            addNotification("AI features are disabled.", "error");
            return;
        }
        setIsFeedbackLoading(true);

        const incorrectAnswers = questions.map((q, i) => ({...q, userAnswer: userAnswers[i]})).filter((q, i) => q.correctAnswerIndex !== userAnswers[i]);
        if (incorrectAnswers.length === 0) {
            addNotification("Great job! All answers were correct.", "success");
            setIsFeedbackLoading(false);
            return;
        }

        const prompt = `For the following quiz questions that were answered incorrectly, provide a brief, one-sentence explanation for why the correct answer is right. Return a JSON object where the key is the question index and the value is the explanation.\n\n${JSON.stringify(incorrectAnswers.map((q,i) => ({ questionIndex: questions.findIndex(orig => orig.question === q.question), question: q.question, options: q.options, correctAnswer: q.options[q.correctAnswerIndex] })))}`;

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                 config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            explanations: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        questionIndex: { type: Type.INTEGER },
                                        explanation: { type: Type.STRING }
                                    }
                                }
                            }
                        }
                    }
                 }
            });
            const result = JSON.parse(response.text);
            const newFeedback = result.explanations.reduce((acc, item) => {
                acc[item.questionIndex] = item.explanation;
                return acc;
            }, {});
            setFeedback(newFeedback);
        } catch(err) {
            console.error(err);
            addNotification("Could not generate AI feedback.", "error");
        } finally {
            setIsFeedbackLoading(false);
        }
    };

    const renderContent = () => {
        if (isLoading) return <div className="spinner-container"><div className="spinner" /></div>;
        
        if (isFinished) {
            return (
                <div className="quiz-results">
                    <h2>Quiz Complete!</h2>
                    <p className="quiz-score">Your Score: {score} / {questions.length}</p>
                    <div className="quiz-review">
                        {questions.map((q, i) => {
                            const userAnswer = userAnswers[i];
                            const isCorrect = userAnswer === q.correctAnswerIndex;
                            return (
                                <div key={i} className="quiz-review-item">
                                    <div className={`quiz-review-question ${isCorrect ? 'correct' : 'incorrect'}`}>
                                        {isCorrect ? <Icons.check /> : <Icons.xmark />}
                                        <p>{q.question}</p>
                                    </div>
                                    <div className="quiz-review-answers">
                                        <p>Your answer: <strong>{userAnswer !== undefined ? q.options[userAnswer] : 'Not answered'}</strong></p>
                                        {!isCorrect && <p>Correct answer: <strong>{q.options[q.correctAnswerIndex]}</strong></p>}
                                    </div>
                                    {feedback[i] && <p className="ai-feedback">{feedback[i]}</p>}
                                </div>
                            );
                        })}
                    </div>
                    <div className="modal-footer" style={{ justifyContent: 'space-between', marginTop: '1rem', paddingTop: '1rem' }}>
                         <button className="btn btn-secondary" onClick={onClose}>Close</button>
                         <button className="btn btn-primary" onClick={handleGetFeedback} disabled={isFeedbackLoading}>
                            {isFeedbackLoading ? <span className="spinner" /> : <><Icons.sparkles/> Get AI Feedback</>}
                         </button>
                    </div>
                </div>
            );
        }

        const currentQuestion = questions[currentQuestionIndex];
        if (!currentQuestion) return <p>No question to display.</p>;

        return (
            <div className="quiz-container">
                <p className="quiz-progress">Question {currentQuestionIndex + 1} of {questions.length}</p>
                <h4 className="quiz-question">{currentQuestion.question}</h4>
                <div className="quiz-options">
                    {currentQuestion.options.map((option, index) => (
                         <button 
                            key={index}
                            className={`quiz-option-btn ${userAnswers[currentQuestionIndex] === index ? 'selected' : ''}`}
                            onClick={() => handleAnswer(index)}
                            disabled={userAnswers[currentQuestionIndex] !== undefined}
                         >
                            {option}
                         </button>
                    ))}
                </div>
            </div>
        );
    };

    return createPortal(
        <div className="modal-overlay">
            <div className="modal-content large">
                <div className="modal-header">
                    <h3>Quiz: {resource.name}</h3>
                    <button onClick={onClose} className="modal-close-btn"><Icons.close /></button>
                </div>
                <div className="modal-body">
                    {renderContent()}
                </div>
            </div>
        </div>,
        document.body
    );
};

// --- AUTHENTICATION ---
const AuthView = () => {
    const { users, setCurrentUser, setUsers, addNotification, addAuditLog } = useContext(AppContext);
    const [isLoginView, setIsLoginView] = useState(true);
    const [isFlipped, setIsFlipped] = useState(false);
    
    // Login State
    const [loginId, setLoginId] = useState('');
    const [loginPassword, setLoginPassword] = useState('');
    
    // Signup State
    const [signupName, setSignupName] = useState('');
    const [signupRole, setSignupRole] = useState<UserRole>('student');
    const [signupDept, setSignupDept] = useState('CSE');
    const [signupYear, setSignupYear] = useState('I');
    const [signupPassword, setSignupPassword] = useState('');

    const handleLogin = (e: React.FormEvent) => {
        e.preventDefault();
        const user = users.find(u => u.id === loginId && u.password === loginPassword);
        if (user) {
            if (user.isLocked) {
                addNotification('Your account is locked. Please contact an administrator.', 'error');
                addAuditLog('LOGIN_ATTEMPT_LOCKED', 'failure', `User: ${loginId}`);
                return;
            }
             if (user.status === 'active') {
                setCurrentUser(user);
                addNotification(`Welcome back, ${user.name}!`, 'success');
                addAuditLog('LOGIN', 'success');
            } else {
                addNotification(`Your account is ${user.status.replace('_', ' ')}.`, 'warning');
                addAuditLog('LOGIN_ATTEMPT_INACTIVE', 'failure', `User: ${loginId}, Status: ${user.status}`);
            }
        } else {
            addNotification('Invalid username or password.', 'error');
             addAuditLog('LOGIN_ATTEMPT_FAILED', 'failure', `User: ${loginId}`);
        }
    };

    const handleSignup = (e: React.FormEvent) => {
        e.preventDefault();
        const newUser: User = {
            id: `user_${Date.now()}`,
            name: signupName,
            role: signupRole,
            dept: signupDept,
            year: signupRole === 'student' ? signupYear : undefined,
            password: signupPassword,
            status: 'pending_approval'
        };
        setUsers(prev => [...prev, newUser]);
        addNotification('Registration successful! Please wait for admin approval.', 'success');
        addAuditLog('SIGNUP', 'info', `New user: ${newUser.name}`);
        toggleView();
    };

    const toggleView = () => {
        setIsFlipped(!isFlipped);
        setTimeout(() => setIsLoginView(!isLoginView), 300); // Sync with animation
    };

    return (
        <div className="login-view-container">
            <div className="login-card">
                 <div className={`login-card-inner ${isFlipped ? 'is-flipped' : ''}`}>
                    <div className="login-card-front">
                        <div className="login-header">
                            <span className="logo"><Icons.logo /></span>
                            <h1>Welcome to AcademiaAI</h1>
                            <p>Sign in to your account</p>
                        </div>
                        <form onSubmit={handleLogin}>
                            <div className="control-group">
                                <label htmlFor="loginId">User ID</label>
                                <input id="loginId" type="text" className="form-control" value={loginId} onChange={e => setLoginId(e.target.value)} required />
                            </div>
                            <div className="control-group">
                                <label htmlFor="loginPassword">Password</label>
                                <input id="loginPassword" type="password" className="form-control" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} required />
                            </div>
                            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}>Login</button>
                        </form>
                        <p className="auth-hint">Try: id: <strong>stud001</strong>, pass: <strong>password</strong></p>
                         <div className="auth-toggle">
                            Don't have an account? <button onClick={toggleView}>Sign up</button>
                        </div>
                    </div>
                     <div className="login-card-back">
                        <div className="login-header">
                             <span className="logo"><Icons.logo /></span>
                             <h1>Create an Account</h1>
                             <p>Join the AcademiaAI platform</p>
                        </div>
                         <form onSubmit={handleSignup}>
                            <div className="control-group">
                                <label>Full Name</label>
                                <input type="text" className="form-control" value={signupName} onChange={e => setSignupName(e.target.value)} required />
                            </div>
                            <div className="form-grid">
                                <div className="control-group">
                                    <label>Role</label>
                                    <select className="form-control" value={signupRole} onChange={e => setSignupRole(e.target.value as UserRole)}>
                                        <option value="student">Student</option>
                                        <option value="faculty">Faculty</option>
                                    </select>
                                </div>
                                <div className="control-group">
                                     <label>Department</label>
                                    <select className="form-control" value={signupDept} onChange={e => setSignupDept(e.target.value)}>
                                        {DEPARTMENTS.slice(0, 7).map(d => <option key={d} value={d}>{d}</option>)}
                                    </select>
                                </div>
                            </div>
                            {signupRole === 'student' && (
                                <div className="control-group">
                                    <label>Year</label>
                                    <select className="form-control" value={signupYear} onChange={e => setSignupYear(e.target.value)}>
                                        {['I', 'II', 'III', 'IV'].map(y => <option key={y} value={y}>{y}</option>)}
                                    </select>
                                </div>
                            )}
                             <div className="control-group">
                                <label>Password</label>
                                <input type="password" className="form-control" value={signupPassword} onChange={e => setSignupPassword(e.target.value)} required />
                            </div>
                             <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}>Register</button>
                        </form>
                         <div className="auth-toggle">
                            Already have an account? <button onClick={toggleView}>Log in</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- CHATBOT & AI FEATURES ---

const Chatbot = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [chat, setChat] = useState<Chat | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    
    useEffect(() => {
        if(isOpen && ai && !chat) {
            const newChat = ai.chats.create({
                model: 'gemini-2.5-flash',
                config: {
                    systemInstruction: 'You are a helpful academic assistant for a college portal. Be concise and friendly.'
                }
            });
            setChat(newChat);
        }
    }, [isOpen, ai, chat]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);
    
    const handleSend = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!input.trim() || isLoading || !chat) return;

        const userMessage: ChatMessage = { id: `msg_${Date.now()}`, role: 'user', text: input };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);

        try {
            let response = await chat.sendMessageStream({ message: input });
            let modelResponseText = '';
            for await (const chunk of response) {
                modelResponseText += chunk.text;
                setMessages(prev => {
                    const lastMsg = prev[prev.length -1];
                    if (lastMsg.role === 'model') {
                        const newMessages = [...prev];
                        newMessages[newMessages.length-1] = {...lastMsg, text: modelResponseText };
                        return newMessages;
                    } else {
                        return [...prev, {id: `msg_model_${Date.now()}`, role: 'model', text: modelResponseText }]
                    }
                });
            }
        } catch (error) {
            console.error(error);
            const errorMessage: ChatMessage = { id: `msg_err_${Date.now()}`, role: 'model', text: 'Sorry, something went wrong.', isError: true };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };
    
    if (!isAiEnabled) return null;

    return (
        <div className={`chatbot-container ${isOpen ? 'open' : ''}`}>
            <button className="chatbot-toggle" onClick={() => setIsOpen(!isOpen)} aria-label={isOpen ? 'Close chat' : 'Open chat'}>
                {isOpen ? <Icons.close /> : <Icons.sparkles />}
            </button>
             {isOpen && (
                <div className="chatbot-window">
                    <div className="chatbot-header">AI Assistant</div>
                    <div className="chatbot-messages">
                        {messages.map((msg) => (
                            <div key={msg.id} className={`chat-bubble ${msg.role}`}>
                                <div dangerouslySetInnerHTML={{ __html: marked(msg.text) }}></div>
                            </div>
                        ))}
                        {isLoading && <div className="chat-bubble model"><span className="typing-indicator"></span></div>}
                        <div ref={messagesEndRef} />
                    </div>
                    <form className="chatbot-input-form" onSubmit={handleSend}>
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Ask me anything..."
                            disabled={isLoading}
                        />
                        <button type="submit" disabled={isLoading || !input.trim()}><Icons.send /></button>
                    </form>
                </div>
            )}
        </div>
    );
};

const AIStudyPlanGenerator = () => {
    const { currentUser, addNotification } = useContext(AppContext);
    const [subject, setSubject] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [studyPlan, setStudyPlan] = useState<StudyPlan | null>(null);

    const generatePlan = async () => {
        if (!ai || !subject) return;
        setIsLoading(true);
        setStudyPlan(null);
        
        const studentInfo = `I am a ${currentUser.year} year ${currentUser.dept} student.`;
        const prompt = `Create a detailed 2-week study plan for the subject "${subject}". ${studentInfo} Break it down by week and day, with specific topics and small, actionable tasks for each day.`;

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            title: { type: Type.STRING },
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
                                                    day: { type: Type.STRING },
                                                    topic: { type: Type.STRING },
                                                    tasks: {
                                                        type: Type.ARRAY,
                                                        items: {
                                                            type: Type.OBJECT,
                                                            properties: {
                                                                text: { type: Type.STRING },
                                                                completed: { type: Type.BOOLEAN }
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
            const plan = JSON.parse(response.text);
            setStudyPlan(plan);
        } catch (err) {
            console.error(err);
            addNotification("Failed to generate study plan.", "error");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div>
            <div className="ai-feature-card-header">
                <Icons.sparkles />
                <h3>AI Study Plan Generator</h3>
            </div>
            <p>Enter a subject to generate a personalized 2-week study schedule.</p>
            <div className="ai-generator-form">
                <input
                    type="text"
                    className="form-control"
                    placeholder="e.g., Data Structures"
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                    disabled={isLoading}
                />
                <button className="btn btn-primary" onClick={generatePlan} disabled={isLoading}>
                    {isLoading ? <span className="spinner" /> : 'Generate Plan'}
                </button>
            </div>
            {studyPlan && (
                <div className="study-plan-container">
                    <h4>{studyPlan.title}</h4>
                    {/* Render the plan here */}
                </div>
            )}
        </div>
    );
};

const CommandBar = ({ onClose }) => {
    const { setCurrentView, users, resources, addNotification } = useContext(AppContext);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [searchResults, setSearchResults] = useState([]);
    const inputRef = useRef<HTMLInputElement>(null);

    const NAV_ITEMS = [
        { view: 'dashboard', label: 'Dashboard', icon: <Icons.dashboard /> },
        { view: 'timetable', label: 'Timetable', icon: <Icons.timetable /> },
        { view: 'announcements', label: 'Announcements', icon: <Icons.announcements /> },
        { view: 'userManagement', label: 'User Management', icon: <Icons.userManagement /> },
        { view: 'studentDirectory', label: 'Student Directory', icon: <Icons.studentDirectory /> },
        { view: 'courseFiles', label: 'Course Files', icon: <Icons.courseFiles /> },
        { view: 'resources', label: 'Resources', icon: <Icons.resources /> },
        { view: 'security', label: 'Security', icon: <Icons.security /> },
    ];

    useEffect(() => {
        if (!input) {
            setSearchResults([]);
            return;
        }

        const lowercasedInput = input.toLowerCase();
        const navResults = NAV_ITEMS.filter(item => item.label.toLowerCase().includes(lowercasedInput))
            .map(item => ({...item, type: 'navigate'}));
        const userResults = users.filter(user => user.name.toLowerCase().includes(lowercasedInput))
            .map(user => ({...user, type: 'user', icon: <Icons.userCircle/>}));
        const resourceResults = resources.filter(res => res.name.toLowerCase().includes(lowercasedInput))
            .map(res => ({...res, type: 'resource', icon: <Icons.book />}));
        
        const results = [];
        if (navResults.length > 0) results.push({ category: 'Navigation', items: navResults });
        if (userResults.length > 0) results.push({ category: 'Users', items: userResults });
        if (resourceResults.length > 0) results.push({ category: 'Resources', items: resourceResults });

        setSearchResults(results);
    }, [input, users, resources]);
    
    const handleSelectResult = (item) => {
        switch(item.type) {
            case 'navigate':
                setCurrentView(item.view);
                break;
            case 'user':
                addNotification(`Showing details for ${item.name}`, 'info');
                // Future: navigate to a user profile page
                break;
             case 'resource':
                addNotification(`Showing resource: ${item.name}`, 'info');
                // Future: open resource details
                break;
        }
        onClose();
    };


    useEffect(() => {
        inputRef.current?.focus();
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const handleCommand = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!ai || !input || searchResults.length > 0) return;
        setIsLoading(true);

        const prompt = `You are a command parser for an academic portal app. Analyze the user's command: "${input}". Respond ONLY with a JSON object. Possible actions are 'navigate', 'search_user', 'create_announcement'. For 'navigate', payload should be { "view": "view_name" }. For 'search_user', payload should be { "name": "user_name" }. For 'create_announcement', the payload should be { "prompt": "details for announcement"}. Valid views: dashboard, timetable, announcements, userManagement, studentDirectory, resources, security, settings.`;

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: { responseMimeType: "application/json", responseSchema: { type: Type.OBJECT, properties: { action: { type: Type.STRING }, payload: { type: Type.OBJECT } } } }
            });
            const command = JSON.parse(response.text);

            switch (command.action) {
                case 'navigate': setCurrentView(command.payload.view); break;
                case 'search_user': addNotification(`AI search found user: "${command.payload.name}".`, 'info'); break;
                case 'create_announcement': addNotification(`Opening new announcement with prompt: "${command.payload.prompt}"`, 'info'); break;
                default: addNotification("Sorry, I didn't understand that command.", "warning");
            }
            onClose();

        } catch (err) {
            console.error(err);
            addNotification("Could not process the command.", "error");
        } finally {
            setIsLoading(false);
        }
    };
    
    return createPortal(
        <div className="modal-overlay command-bar-overlay" onClick={onClose}>
            <div className="command-bar-content" onClick={(e) => e.stopPropagation()}>
                <form onSubmit={handleCommand}>
                    <div className="command-bar-input-wrapper">
                         <Icons.search />
                         <input 
                            ref={inputRef}
                            type="text" 
                            placeholder="Type a command or search... (e.g., 'go to timetable')"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            disabled={isLoading}
                        />
                        {isLoading && <span className="spinner" />}
                    </div>
                </form>
                 <div className="command-bar-results">
                    {searchResults.map(group => (
                        <div key={group.category} className="results-group">
                            <h4 className="results-category">{group.category}</h4>
                            <ul>
                                {group.items.map(item => (
                                    <li key={item.id || item.view} onClick={() => handleSelectResult(item)}>
                                        {item.icon}
                                        <span>{item.name || item.label}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                    {!isLoading && input && searchResults.length === 0 && (
                        <div className="results-empty">No results found. Press Enter to ask AI.</div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

// --- NOTIFICATIONS ---
const NotificationContainer = ({ notifications, setNotifications }) => {
    const removeNotification = (id: string) => {
        setNotifications(prev => prev.filter(n => n.id !== id));
    };

    return createPortal(
        <div className="notification-container">
            {notifications.map(n => (
                <div key={n.id} className={`notification-toast toast-${n.type}`}>
                    <div className="toast-icon">
                        {n.type === 'success' ? <Icons.check /> : n.type === 'error' ? <Icons.xmark /> : <Icons.info />}
                    </div>
                    <p>{n.message}</p>
                    <button onClick={() => removeNotification(n.id)} className="toast-close-btn"><Icons.close/></button>
                </div>
            ))}
        </div>,
        document.body
    );
};

const CourseFileReviewModal = ({ file, onClose }) => {
    const { aiReview } = file;
    return createPortal(
         <div className="modal-overlay">
            <div className="modal-content large">
                 <div className="modal-header">
                    <h3><Icons.sparkles/> AI Review: {file.subject}</h3>
                    <button onClick={onClose} className="modal-close-btn"><Icons.close/></button>
                </div>
                <div className="modal-body">
                    {aiReview ? (
                        <div className="ai-review-content">
                            <h4>Summary</h4>
                            <p>{aiReview.summary}</p>
                            
                            <h4>Suggestions for Improvement</h4>
                            <ul>
                                {aiReview.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                            </ul>

                            {aiReview.corrections && aiReview.corrections.length > 0 && (
                                <>
                                <h4>Potential Corrections</h4>
                                <ul className="corrections-list">
                                    {aiReview.corrections.map((c, i) => <li key={i}><strong>Original:</strong> {c.original} <br/> <strong>Corrected:</strong> {c.corrected}</li>)}
                                </ul>
                                </>
                            )}
                        </div>
                    ) : (
                        <p>No AI review available for this file.</p>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}

const PlaceholderView = ({ title }) => {
    return (
        <div className="placeholder-view">
            <h2>{title}</h2>
            <p>This feature is under construction.</p>
        </div>
    );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);