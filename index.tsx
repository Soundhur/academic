/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { GoogleGenAI, Chat, Type, GenerateContentResponse, Modality } from "@google/genai";
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
    type: 'break' | 'class' | 'common' | 'lab';
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
    studyPlans?: StudyPlan[];
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
    date: string; // Using YYYY-MM-DD string for easier storage
    title: string;
    type: 'exam' | 'holiday' | 'event' | 'deadline';
}


interface AppNotification {
    id: string;
    message: string;
    type: 'info' | 'success' | 'error' | 'warning';
}

interface HistoricalNotification extends AppNotification {
    timestamp: number;
    isRead: boolean;
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

interface AppTheme {
    name: string;
    colors: {
        '--accent-primary': string;
        '--accent-primary-hover': string;
    };
}
interface AppSettings {
    timeSlots: string[];
    accentColor: string;
    theme: 'light' | 'dark';
    activeTheme: string;
}

interface StudyPlan {
    id: string;
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


const DEPARTMENTS = ["CSE", "ECE", "EEE", "MCA", "AI&DS", "CYBERSECURITY", "MECHANICAL", "TAMIL", "ENGLISH", "MATHS", "LIB", "NSS", "NET", "Administration", "IT"];
const YEARS = ["I", "II", "III", "IV"];
const ROLES: UserRole[] = ['student', 'faculty', 'hod', 'admin', 'class advisor', 'principal'];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const THEMES: AppTheme[] = [
    { name: 'Default Blue', colors: { '--accent-primary': '#3B82F6', '--accent-primary-hover': '#2563EB' } },
    { name: 'Ocean Green', colors: { '--accent-primary': '#10b981', '--accent-primary-hover': '#059669' } },
    { name: 'Sunset Orange', colors: { '--accent-primary': '#f59e0b', '--accent-primary-hover': '#d97706' } },
    { name: 'Royal Purple', colors: { '--accent-primary': '#8b5cf6', '--accent-primary-hover': '#7c3aed' } },
];

// --- MOCK DATA ---
const initialUsers: User[] = [
    { id: 'user_1', name: 'Dr. Evelyn Reed', role: 'principal', dept: 'Administration', status: 'active', isLocked: false },
    { id: 'user_2', name: 'Admin User', role: 'admin', dept: 'IT', status: 'active', isLocked: false },
    { id: 'user_3', name: 'Prof. Samuel Chen', role: 'hod', dept: 'CSE', status: 'active', isLocked: false },
    { id: 'user_4', name: 'Prof. Aisha Khan', role: 'faculty', dept: 'ECE', status: 'active', isLocked: false },
    { id: 'user_5', name: 'John Doe', role: 'student', dept: 'CSE', year: 'II', status: 'active', grades: [{ subject: 'Data Structures', score: 85 }, { subject: 'Algorithms', score: 92 }], attendance: { present: 78, total: 85 }, isLocked: false, studyPlans: [] },
    { id: 'user_6', name: 'Jane Smith', role: 'student', dept: 'CSE', year: 'II', status: 'pending_approval', isLocked: false, studyPlans: [] },
    { id: 'user_7', name: 'Creator', role: 'creator', dept: 'IT', status: 'active', isLocked: false },
];

const initialTimetable: TimetableEntry[] = [
    { id: 'tt_1', department: 'CSE', year: 'II', day: 'Monday', timeIndex: 0, subject: 'Data Structures', type: 'class', faculty: 'Prof. Chen', room: 'CS101' },
    { id: 'tt_2', department: 'CSE', year: 'II', day: 'Monday', timeIndex: 1, subject: 'Algorithms', type: 'class', faculty: 'Dr. Reed', room: 'CS102' },
    { id: 'tt_3', department: 'CSE', year: 'II', day: 'Tuesday', timeIndex: 2, subject: 'Database Systems', type: 'class', faculty: 'Prof. Khan', room: 'CS101' },
    { id: 'tt_4', department: 'CSE', year: 'II', day: 'Monday', timeIndex: 2, subject: 'Break', type: 'break' },
];

const initialAnnouncements: Announcement[] = [
    { id: 'ann_1', title: 'Mid-term Exam Schedule', content: 'The mid-term exam schedule for all departments has been published. Please check the notice board.', author: 'Dr. Evelyn Reed', authorId: 'user_1', timestamp: Date.now() - 86400000, targetRole: 'all', targetDept: 'all' },
    { id: 'ann_2', title: 'Guest Lecture on AI', content: 'A guest lecture on "The Future of Artificial Intelligence" will be held on Friday in the main auditorium.', author: 'Prof. Samuel Chen', authorId: 'user_3', timestamp: Date.now(), targetRole: 'student', targetDept: 'CSE' },
];

const initialResources: Resource[] = [
    { id: 'res_1', name: 'Data Structures Notes', type: 'notes', department: 'CSE', subject: 'Data Structures', uploaderId: 'user_3', uploaderName: 'Prof. Samuel Chen', timestamp: Date.now() },
    { id: 'res_2', name: 'Digital Circuits Textbook', type: 'book', department: 'ECE', subject: 'Digital Circuits', uploaderId: 'user_4', uploaderName: 'Prof. Aisha Khan', timestamp: Date.now() - 172800000 },
];

const initialCourseFiles: CourseFile[] = [
    { id: 'cf_1', facultyId: 'user_3', facultyName: 'Prof. Samuel Chen', department: 'CSE', subject: 'Data Structures', semester: '4', files: [{ name: 'Syllabus.pdf', type: 'syllabus' }, { name: 'Unit1_Notes.pdf', type: 'notes' }], status: 'approved', submittedAt: Date.now() - 86400000 * 5 },
    { id: 'cf_2', facultyId: 'user_4', facultyName: 'Prof. Aisha Khan', department: 'ECE', subject: 'Digital Logic', semester: '3', files: [{ name: 'Syllabus.pdf', type: 'syllabus' }], status: 'pending_review', submittedAt: Date.now() - 86400000 * 2 },
];

const initialCalendarEvents: CalendarEvent[] = [
    { id: 'evt_1', date: new Date(new Date().getFullYear(), new Date().getMonth(), 15).toISOString().split('T')[0], title: 'Mid-term Exams Start', type: 'exam' },
    { id: 'evt_2', date: new Date(new Date().getFullYear(), new Date().getMonth(), 25).toISOString().split('T')[0], title: 'Project Submission Deadline', type: 'deadline' },
    { id: 'evt_3', date: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString().split('T')[0], title: 'Next Semester Begins', type: 'event' },
    { id: 'evt_4', date: new Date().toISOString().split('T')[0], title: 'Staff Meeting', type: 'event' },
];


const initialSecurityAlerts: SecurityAlert[] = [
     { id: 'sec_1', type: 'Anomaly', title: 'Multiple Failed Logins', description: 'User account for "John Doe" (user_5) had 5 failed login attempts.', timestamp: Date.now() - 3600000, severity: 'medium', relatedUserId: 'user_5', isResolved: false, responsePlan: { containment: 'Monitor account activity.', investigation: 'Verify with user if attempts were legitimate.', recovery: 'Reset password if compromised.', recommendedAction: 'LOCK_USER' } },
     { id: 'sec_2', type: 'Threat', title: 'Suspected Phishing Link', description: 'A resource uploaded by Prof. Khan contained a suspicious URL.', timestamp: Date.now() - 86400000, severity: 'high', relatedUserId: 'user_4', isResolved: true },
     { id: 'sec_3', type: 'Threat', title: 'Unauthorized Dept Change', description: 'User Jane Smith (user_6) attempted to change department settings.', timestamp: Date.now() - 172800000, severity: 'critical', relatedUserId: 'user_6', isResolved: false, responsePlan: { containment: 'Revert changes immediately.', investigation: 'Check audit logs for related activity.', recovery: 'Ensure user permissions are correct.', recommendedAction: 'MONITOR' } },
];

const initialAppSettings: AppSettings = {
    timeSlots: ["9:00 - 10:00", "10:00 - 11:00", "11:00 - 12:00", "12:00 - 1:00", "2:00 - 3:00", "3:00 - 4:00"],
    accentColor: '#3B82F6', // Legacy, now managed by theme
    theme: 'light',
    activeTheme: 'Default Blue',
};

// --- UTILITY FUNCTIONS ---
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

const useAppNotifications = () => {
    const [notifications, setNotifications] = useLocalStorage<HistoricalNotification[]>('app_notifications_history', []);
    const [toastQueue, setToastQueue] = useState<AppNotification[]>([]);

    const addNotification = (message: string, type: AppNotification['type'] = 'info') => {
        const id = `notif_${Date.now()}`;
        const newNotification: HistoricalNotification = { id, message, type, timestamp: Date.now(), isRead: false };

        setNotifications(prev => [newNotification, ...prev.slice(0, 19)]); // Keep last 20
        setToastQueue(prev => [...prev, { id, message, type }]);

        setTimeout(() => {
            setToastQueue(prev => prev.filter(n => n.id !== id));
        }, 5000);
    };

    const markAllAsRead = () => {
        setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    };
    
    const clearNotifications = () => {
        setNotifications([]);
    };

    const unreadCount = useMemo(() => notifications.filter(n => !n.isRead).length, [notifications]);

    return { notifications, toastQueue, addNotification, markAllAsRead, clearNotifications, unreadCount };
};

const formatRelativeTime = (timestamp: number) => {
    const now = new Date();
    const seconds = Math.floor((now.getTime() - timestamp) / 1000);
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


// --- UI COMPONENTS ---

const Icon = ({ name, className = '' }: { name: string, className?: string }) => {
    const icons: { [key: string]: JSX.Element } = {
        dashboard: <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25a2.25 2.25 0 01-2.25 2.25h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />,
        timetable: <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0h18M-7.5 12h13.5" />,
        manage: <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />,
        settings: <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-1.007 1.11-1.11h2.596c.55.103 1.02.568 1.11 1.11l.09 1.586c.294.049.58.12.856.216l1.373-.793c.49-.283 1.096-.046 1.378.444l1.3 2.252c.282.49-.046 1.096-.444 1.378l-1.148.664c.06.27.11.543.15.82l.09 1.586c-.103.55-.568 1.02-1.11 1.11h-2.596c-.55-.103-1.02-.568-1.11-1.11l-.09-1.586a7.447 7.447 0 01-.856-.216l-1.373.793c-.49.283-1.096.046-1.378-.444l-1.3-2.252c-.282-.49.046 1.096.444-1.378l1.148-.664a7.452 7.452 0 01.15-.82l.09-1.586zM12 15a3 3 0 100-6 3 3 0 000 6z" />,
        approvals: <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
        announcements: <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 1.87c.23-.46.89-.46 1.12 0l1.45 2.92a1 1 0 00.95.69h3.19c.53 0 .76.68.35 1l-2.58 1.88a1 1 0 00-.36 1.11l.98 3.23c.16.53-.43 1-.89.69L12 11.35a1 1 0 00-1.1 0l-2.52 1.82c-.46.31-1.05-.16-.89-.69l.98-3.23a1 1 0 00-.36-1.11L5.53 7.48c-.4-.32-.18-1 .35-1h3.19a1 1 0 00.95-.69l1.45-2.92z" />,
        studentDirectory: <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 00-5.658-1.682M15 19.128v-3.872M15 19.128c.328.054.66.085.996.085A9.37 9.37 0 0024 10.072V8.5h-4.232c-.332 0-.652-.085-.94-.246l-2.22-1.11a1.2 1.2 0 00-1.22 0L12 7.254c-.288.16-.608.246-.94.246H6.828v1.572A9.37 9.37 0 0015 19.128zM1.5 9.375c0-4.04 3.28-7.32 7.32-7.32s7.32 3.28 7.32 7.32c0 1.63-2.427 4.19-7.32 4.19S1.5 11.005 1.5 9.375z" />,
        security: <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />,
        userManagement: <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m-7.04-2.72a3 3 0 00-4.682 2.72 9.094 9.094 0 003.741.479m7.04-2.72a3 3 0 01-4.682-2.72 9.094 9.094 0 013.741-.479m-7.04 2.72a3 3 0 01-4.682 2.72 9.094 9.094 0 013.741-.479M12 12a3 3 0 100-6 3 3 0 000 6z" />,
        resources: <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6-2.292m0 0v14.25" />,
        academicCalendar: <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0h18M-7.5 12h13.5" />,
        courseFiles: <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />,
        logout: <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />,
        close: <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />,
        menu: <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />,
        search: <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />,
        bell: <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />,
        plus: <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />,
        edit: <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />,
        trash: <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />,
        upload: <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />,
        download: <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />,
        book: <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6-2.292m0 0v14.25" />,
        notes: <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />,
        project: <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1.125-1.5M9 16.5l1.125-1.5m0 0l1.125 1.5M10.125 15l1.125-1.5" />,
        lab: <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21a3 3 0 003-3h3a3 3 0 003 3M7.5 3a3 3 0 00-3 3v1.5M7.5 3h9a3 3 0 013 3v1.5M12 12a3 3 0 013 3m-3-3a3 3 0 00-3 3m3-3V6M6 12a3 3 0 013-3h6a3 3 0 013 3m-9 3a3 3 0 00-3 3" />,
        other: <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.5 13.5h.008v.008H16.5v-.008z" />,
        send: <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />,
        robot: <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 7.5V6.108c0-1.135.845-2.098 1.976-2.192.373-.03.748-.03 1.125 0 1.131.094 1.976 1.057 1.976 2.192V7.5M8.25 7.5h7.5M8.25 7.5a2.25 2.25 0 01-2.25 2.25H6.75a2.25 2.25 0 01-2.25-2.25V6.75a2.25 2.25 0 012.25-2.25h9.5a2.25 2.25 0 012.25 2.25v.75a2.25 2.25 0 01-2.25 2.25H9.75a2.25 2.25 0 01-2.25-2.25z" />,
        check: <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />,
        'x-mark': <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />,
        'chevron-left': <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />,
        'chevron-right': <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />,
        'chevron-up': <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />,
        'chevron-down': <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />,
        'chevron-up-down': <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" />,
        info: <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />,
        warning: <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />,
        success: <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
        error: <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />,
        sparkles: <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.5 13.5h.008v.008H16.5v-.008z" />,
        user: <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />,
        lock: <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />,
        'eye': <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.432 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />,
        'eye-slash': <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.754 0 8.774 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21M12 15a3 3 0 100-6 3 3 0 000 6z" />,
        palette: <path strokeLinecap="round" strokeLinejoin="round" d="M12.075 4.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v1.5a2.25 2.25 0 002.25 2.25h3.075m0-3.75C9.435 4.75 9 5.336 9 6.125v1.75a1.125 1.125 0 102.25 0V6.125c0-.79-.435-1.375-1.125-1.375zM15 9.75a2.25 2.25 0 012.25-2.25h1.5a2.25 2.25 0 012.25 2.25v1.5a2.25 2.25 0 01-2.25 2.25h-1.5a2.25 2.25 0 01-2.25-2.25v-1.5zM15 9.75c0 .79.435 1.375 1.125 1.375h1.75a1.125 1.125 0 100-2.25h-1.75c-.69 0-1.125.585-1.125 1.375zM4.5 15.75a2.25 2.25 0 002.25 2.25h1.5a2.25 2.25 0 002.25-2.25v-1.5a2.25 2.25 0 00-2.25-2.25h-1.5a2.25 2.25 0 00-2.25 2.25v1.5zM4.5 15.75c0 .79.435 1.375 1.125 1.375h1.75a1.125 1.125 0 100-2.25h-1.75C4.935 14.375 4.5 14.96 4.5 15.75z" />,
        key: <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />,
        lightbulb: <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v2.25M12 14.25v5.25M15 17.25v2.25M8.25 12h7.5M12 1.5c-3.314 0-6 2.686-6 6 0 2.033.993 3.843 2.5 4.995V12h7v-1.505c1.507-1.152 2.5-2.962 2.5-4.995 0-3.314-2.686-6-6-6z" />,
        sliders: <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />,
        'calendar-check': <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
        megaphone: <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />,
        'file-check': <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
        'bar-chart': <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75c0 .621-.504 1.125-1.125 1.125h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />,
        'shield-exclamation': <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />,
        today: <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0h18M12 15a2.25 2.25 0 110-4.5 2.25 2.25 0 010 4.5z" />,
        'study-plan': <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6-2.292m0 0V11.25m0 10.042V18.75M12 11.25L15 13.5M12 11.25L9 13.5" />,
    };

    return (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
            {icons[name] || <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />}
        </svg>
    );
};

const Modal = ({ children, onClose, size = 'medium' }: { children: React.ReactNode, onClose: () => void, size?: 'medium' | 'large' }) => {
    useEffect(() => {
        const handleEsc = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [onClose]);

    return createPortal(
        <div className="modal-overlay" onMouseDown={onClose}>
            <div className={`modal-content ${size === 'large' ? 'large' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
                {children}
            </div>
        </div>,
        document.body
    );
};

const NotificationToast = ({ notification, onRemove }: { notification: AppNotification, onRemove: (id: string) => void }) => {
    const iconMap = {
        info: 'info',
        success: 'success',
        error: 'error',
        warning: 'warning',
    };
    return (
        <div className={`notification-toast toast-${notification.type}`}>
            <div className="toast-icon"><Icon name={iconMap[notification.type]} /></div>
            <p>{notification.message}</p>
            <button className="toast-close-btn" onClick={() => onRemove(notification.id)} aria-label="Close notification">
                <Icon name="x-mark" className="w-4 h-4" />
            </button>
        </div>
    );
};

const BarChart = ({ data }: { data: { label: string; value: number }[] }) => {
    const maxValue = Math.max(...data.map(d => d.value), 0);
    return (
        <div className="bar-chart-container">
            {data.map((item, index) => (
                <div key={index} className="bar-wrapper">
                    <div
                        className="bar"
                        style={{ height: `${maxValue > 0 ? (item.value / maxValue) * 100 : 0}%` }}
                        data-value={item.value}
                    ></div>
                    <div className="bar-label">{item.label}</div>
                </div>
            ))}
        </div>
    );
};

// --- VIEWS & MAIN COMPONENTS ---
const AuthView = ({ setView, setCurrentUser, users, addUser, addNotification }: { setView: (view: AppView) => void, setCurrentUser: (user: User | null) => void, users: User[], addUser: (user: User) => void, addNotification: (message: string, type: AppNotification['type']) => void }) => {
    const [isFlipped, setIsFlipped] = useState(false);
    const [loginId, setLoginId] = useState('');
    const [loginPassword, setLoginPassword] = useState('');
    const [signupName, setSignupName] = useState('');
    const [signupRole, setSignupRole] = useState<UserRole>('student');
    const [signupDept, setSignupDept] = useState('CSE');
    const [signupYear, setSignupYear] = useState('I');
    
    const handleLogin = (e: React.FormEvent) => {
        e.preventDefault();
        const user = users.find(u => u.id === loginId);
        if (user) {
             if (user.isLocked) {
                addNotification('Your account is locked. Please contact an administrator.', 'error');
                return;
             }
             if (user.status === 'active') {
                setCurrentUser(user);
                setView('dashboard');
                addNotification(`Welcome back, ${user.name}!`, 'success');
            } else if (user.status === 'pending_approval') {
                addNotification('Your account is pending approval.', 'warning');
            } else {
                 addNotification('Your account registration was rejected.', 'error');
            }
        } else {
            addNotification('Invalid user ID or password.', 'error');
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
            status: 'pending_approval',
            isLocked: false,
        };
        addUser(newUser);
        addNotification('Registration successful! Please wait for admin approval.', 'success');
        setIsFlipped(false);
    };

    return (
        <div className="login-view-container">
            <div className="login-card">
                <div className={`login-card-inner ${isFlipped ? 'is-flipped' : ''}`}>
                    <div className="login-card-front">
                        <div className="login-header">
                            <span className="logo"><Icon name="dashboard" /></span>
                            <h1>Welcome Back</h1>
                            <p>Sign in to continue to your dashboard.</p>
                        </div>
                        <form onSubmit={handleLogin}>
                            <div className="control-group">
                                <label htmlFor="loginId">User ID</label>
                                <input type="text" id="loginId" className="form-control" value={loginId} onChange={e => setLoginId(e.target.value)} placeholder="e.g., user_5" required />
                            </div>
                            <div className="control-group">
                                <label htmlFor="loginPassword">Password</label>
                                <input type="password" id="loginPassword" className="form-control" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} placeholder="••••••••" required />
                            </div>
                            <button type="submit" className="btn btn-primary w-full">Login</button>
                        </form>
                        <div className="auth-toggle">
                            Don't have an account? <button onClick={() => setIsFlipped(true)}>Sign Up</button>
                        </div>
                         <div className="auth-hint">
                            <p><strong>Demo Logins (any password):</strong></p>
                            <p>Admin: <strong>user_2</strong> | HOD: <strong>user_3</strong></p>
                            <p>Faculty: <strong>user_4</strong> | Student: <strong>user_5</strong></p>
                        </div>
                    </div>
                    <div className="login-card-back">
                         <div className="login-header">
                            <span className="logo"><Icon name="userManagement" /></span>
                            <h1>Create Account</h1>
                            <p>Fill in the details to register.</p>
                        </div>
                         <form onSubmit={handleSignup}>
                            <div className="control-group">
                                <label htmlFor="signupName">Full Name</label>
                                <input type="text" id="signupName" className="form-control" value={signupName} onChange={e => setSignupName(e.target.value)} required />
                            </div>
                            <div className="form-grid">
                                <div className="control-group">
                                    <label htmlFor="signupRole">Role</label>
                                    <select id="signupRole" className="form-control" value={signupRole} onChange={e => setSignupRole(e.target.value as UserRole)}>
                                        {ROLES.filter(r => r !== 'creator' && r !== 'admin').map(role => <option key={role} value={role}>{role.charAt(0).toUpperCase() + role.slice(1)}</option>)}
                                    </select>
                                </div>
                                 <div className="control-group">
                                    <label htmlFor="signupDept">Department</label>
                                    <select id="signupDept" className="form-control" value={signupDept} onChange={e => setSignupDept(e.target.value)}>
                                        {DEPARTMENTS.map(dept => <option key={dept} value={dept}>{dept}</option>)}
                                    </select>
                                </div>
                            </div>
                            {signupRole === 'student' && (
                                 <div className="control-group">
                                    <label htmlFor="signupYear">Year</label>
                                    <select id="signupYear" className="form-control" value={signupYear} onChange={e => setSignupYear(e.target.value)}>
                                        {YEARS.map(year => <option key={year} value={year}>{year}</option>)}
                                    </select>
                                </div>
                            )}
                            <button type="submit" className="btn btn-primary w-full">Register</button>
                        </form>
                         <div className="auth-toggle">
                            Already have an account? <button onClick={() => setIsFlipped(false)}>Sign In</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const DashboardView = ({ currentUser, announcements, calendarEvents, users, securityAlerts, setView, setUsers, addNotification }: { currentUser: User; announcements: Announcement[]; calendarEvents: CalendarEvent[]; users: User[]; securityAlerts: SecurityAlert[]; setView: (view: AppView) => void; setUsers: React.Dispatch<React.SetStateAction<User[]>>; addNotification: (m: string, t: AppNotification['type']) => void }) => {
    const [isStudyPlanModalOpen, setStudyPlanModalOpen] = useState(false);

    const getUpcomingEvents = () => {
        const today = new Date().toISOString().split('T')[0];
        return calendarEvents
            .filter(event => event.date >= today)
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
            .slice(0, 3);
    };

    const getRecentAnnouncements = () => {
        return announcements
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 2);
    };

    const pendingApprovalsCount = users.filter(u => u.status === 'pending_approval').length;
    const unresolvedAlerts = securityAlerts.filter(a => !a.isResolved);
    
    const handleSaveStudyPlan = (plan: StudyPlan) => {
        const updatedUser = {
            ...currentUser,
            studyPlans: [...(currentUser.studyPlans || []), plan],
        };
        setUsers(prev => prev.map(u => u.id === currentUser.id ? updatedUser : u));
        addNotification("Study plan saved!", "success");
        setStudyPlanModalOpen(false);
    };

    return (
        <div className="dashboard-container">
            <div>
                <h2 className="dashboard-greeting">Welcome back, {currentUser.name.split(' ')[0]}!</h2>
                <p className="dashboard-subtitle text-secondary">Here's what's happening today.</p>
            </div>
            <div className="dashboard-grid">
                <div className="dashboard-card stagger-item" style={{ animationDelay: '0.1s' }}>
                    <h3><Icon name="academicCalendar" className="inline-block mr-2 w-5 h-5" />Upcoming Events</h3>
                    <div className="feed-list">
                        {getUpcomingEvents().length > 0 ? getUpcomingEvents().map(event => (
                            <div key={event.id} className="feed-item-card">
                                <div className="feed-item-icon"><Icon name="calendar-check" /></div>
                                <div>
                                    <p className="feed-item-title">{event.title}</p>
                                    <p className="feed-item-meta">{new Date(event.date).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })} - <span className={`status-badge status-${event.type}`}>{event.type}</span></p>
                                </div>
                            </div>
                        )) : <p className="text-secondary text-sm">No upcoming events.</p>}
                    </div>
                </div>
                <div className="dashboard-card stagger-item" style={{ animationDelay: '0.2s' }}>
                    <h3><Icon name="announcements" className="inline-block mr-2 w-5 h-5" />Recent Announcements</h3>
                    <div className="feed-list">
                        {getRecentAnnouncements().length > 0 ? getRecentAnnouncements().map(ann => (
                            <div key={ann.id} className="feed-item-card">
                                <div className="feed-item-icon"><Icon name="megaphone" /></div>
                                <div>
                                    <p className="feed-item-title">{ann.title}</p>
                                    <p className="feed-item-meta">by {ann.author}</p>
                                </div>
                            </div>
                        )) : <p className="text-secondary text-sm">No recent announcements.</p>}
                    </div>
                </div>

                {['admin', 'hod', 'principal'].includes(currentUser.role) && pendingApprovalsCount > 0 && (
                    <div className="dashboard-card stagger-item" style={{ animationDelay: '0.3s' }}>
                        <h3><Icon name="approvals" className="inline-block mr-2 w-5 h-5" />Pending Approvals</h3>
                        <div className="feed-item-card">
                           <div className="feed-item-icon"><Icon name="file-check" /></div>
                           <div>
                               <p className="feed-item-title">{pendingApprovalsCount} new user(s) waiting for approval.</p>
                               <button className="btn-link" onClick={() => setView('approvals')}>Review now</button>
                           </div>
                       </div>
                    </div>
                )}

                {currentUser.role === 'student' && (
                     <>
                        <div className="dashboard-card stagger-item" style={{ animationDelay: '0.3s' }}>
                            <h3><Icon name="study-plan" className="inline-block mr-2 w-5 h-5" />AI Study Plan</h3>
                            <div className="feed-item-card">
                                <div className="feed-item-icon"><Icon name="sparkles" /></div>
                                <div>
                                    <p className="feed-item-title">Plan your studies effectively.</p>
                                    <button className="btn-link" onClick={() => setStudyPlanModalOpen(true)}>Generate a new plan</button>
                                </div>
                            </div>
                        </div>
                        <div className="dashboard-card full-width stagger-item" style={{ animationDelay: '0.4s' }}>
                             <h3><Icon name="bar-chart" className="inline-block mr-2 w-5 h-5" />My Stats</h3>
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                 <div>
                                    <h4>Grades</h4>
                                    {currentUser.grades && currentUser.grades.length > 0 ? (
                                        <BarChart data={currentUser.grades.map(g => ({ label: g.subject, value: g.score }))} />
                                    ) : <p className="text-secondary text-sm">No grades recorded yet.</p>}
                                 </div>
                                 <div>
                                     <h4>Attendance</h4>
                                     {currentUser.attendance ? (
                                        <>
                                            <p className="text-3xl font-bold">{((currentUser.attendance.present / currentUser.attendance.total) * 100).toFixed(1)}%</p>
                                            <p className="text-secondary">{currentUser.attendance.present} / {currentUser.attendance.total} classes attended</p>
                                        </>
                                     ) : <p className="text-secondary text-sm">No attendance data available.</p>}
                                 </div>
                             </div>
                         </div>
                     </>
                )}
                
                {currentUser.role === 'admin' && unresolvedAlerts.length > 0 && (
                    <div className="dashboard-card stagger-item" style={{ animationDelay: '0.4s' }}>
                        <h3><Icon name="security" className="inline-block mr-2 w-5 h-5" />Active Security Alerts</h3>
                        <div className="feed-list">
                           {unresolvedAlerts.slice(0, 2).map(alert => (
                               <div key={alert.id} className="feed-item-card">
                                   <div className={`feed-item-icon severity-${alert.severity}`}><Icon name="shield-exclamation" /></div>
                                   <div>
                                       <p className="feed-item-title">{alert.title}</p>
                                       <p className="feed-item-meta"><span className={`status-badge status-${alert.severity}`}>{alert.severity}</span></p>
                                   </div>
                               </div>
                           ))}
                           <button className="btn-link mt-2" onClick={() => setView('security')}>View all alerts</button>
                       </div>
                    </div>
                )}
            </div>
            {isStudyPlanModalOpen && <StudyPlanModal onSave={handleSaveStudyPlan} onClose={() => setStudyPlanModalOpen(false)} addNotification={addNotification} />}
        </div>
    );
};

const TimetableView = ({ currentUser, timetable, settings, setTimetable, addNotification }: { currentUser: User; timetable: TimetableEntry[]; settings: AppSettings; setTimetable: React.Dispatch<React.SetStateAction<TimetableEntry[]>>; addNotification: (m: string, t: AppNotification['type']) => void }) => {
    const [filter, setFilter] = useState({
        department: currentUser.role === 'student' || currentUser.role === 'faculty' ? currentUser.dept : 'CSE',
        year: currentUser.role === 'student' ? currentUser.year : 'II',
    });
    const [editingCell, setEditingCell] = useState<TimetableEntry | null>(null);
    const [isAIAssistantOpen, setAIAssistantOpen] = useState(false);


    const filteredTimetable = useMemo(() => {
        return timetable.filter(entry => entry.department === filter.department && entry.year === filter.year);
    }, [timetable, filter]);

    const handleCellClick = (day: string, timeIndex: number) => {
        if (!['admin', 'hod', 'creator'].includes(currentUser.role)) return;

        const existingEntry = filteredTimetable.find(e => e.day === day && e.timeIndex === timeIndex);
        setEditingCell(existingEntry || {
            id: `new_${Date.now()}`,
            department: filter.department,
            year: filter.year || 'I',
            day,
            timeIndex,
            subject: '',
            type: 'class',
        });
    };
    
    const handleSave = (entryToSave: TimetableEntry) => {
        if (!entryToSave.subject) { // If subject is empty, consider it a deletion
            setTimetable(prev => prev.filter(e => e.id !== entryToSave.id));
        } else {
             const existing = timetable.find(e => e.id === entryToSave.id);
            if (existing) {
                setTimetable(prev => prev.map(e => e.id === entryToSave.id ? entryToSave : e));
            } else {
                setTimetable(prev => [...prev, { ...entryToSave, id: `tt_${Date.now()}` }]);
            }
        }
        setEditingCell(null);
    };

    const TimetableModal = ({ entry, onSave, onClose }: { entry: TimetableEntry, onSave: (entry: TimetableEntry) => void, onClose: () => void }) => {
        const [formData, setFormData] = useState(entry);

        const handleSubmit = (e: React.FormEvent) => {
            e.preventDefault();
            onSave(formData);
        };
        
        const handleDelete = () => {
            onSave({ ...formData, subject: '' }); // Save with empty subject to delete
        };

        return (
            <Modal onClose={onClose}>
                <div className="modal-header">
                    <h3>Edit Timetable Slot</h3>
                    <button onClick={onClose} className="modal-close-btn"><Icon name="close" /></button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className="modal-body">
                        <p className="text-secondary mb-4">{formData.day}, {settings.timeSlots[formData.timeIndex]}</p>
                        <div className="control-group">
                            <label htmlFor="subject">Subject</label>
                            <input id="subject" type="text" className="form-control" value={formData.subject} onChange={e => setFormData({...formData, subject: e.target.value})} placeholder="e.g. Data Structures" />
                        </div>
                        <div className="control-group">
                            <label htmlFor="type">Type</label>
                            <select id="type" className="form-control" value={formData.type} onChange={e => setFormData({...formData, type: e.target.value as TimetableEntry['type'] })}>
                                <option value="class">Class</option>
                                <option value="lab">Lab</option>
                                <option value="break">Break</option>
                                <option value="common">Common Hour</option>
                            </select>
                        </div>
                        {formData.type === 'class' && (
                        <>
                            <div className="control-group">
                                <label htmlFor="faculty">Faculty</label>
                                <input id="faculty" type="text" className="form-control" value={formData.faculty || ''} onChange={e => setFormData({...formData, faculty: e.target.value})} placeholder="e.g. Prof. Chen" />
                            </div>
                            <div className="control-group">
                                <label htmlFor="room">Room No.</label>
                                <input id="room" type="text" className="form-control" value={formData.room || ''} onChange={e => setFormData({...formData, room: e.target.value})} placeholder="e.g. CS101" />
                            </div>
                        </>
                        )}
                    </div>
                    <div className="modal-footer">
                        {entry.subject && <button type="button" className="btn btn-danger-outline" onClick={handleDelete}>Delete</button>}
                        <div>
                           <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
                           <button type="submit" className="btn btn-primary">Save Changes</button>
                        </div>
                    </div>
                </form>
            </Modal>
        );
    };

    return (
        <>
            <div className="timetable-header">
                 <div className="view-header !mb-0 flex-grow">
                    <h2 className="text-2xl font-bold">Timetable</h2>
                    {['admin', 'hod', 'creator'].includes(currentUser.role) && (
                        <button className="btn btn-primary" onClick={() => setAIAssistantOpen(true)}>
                            <Icon name="robot" className="w-4 h-4" /> AI Assistant
                        </button>
                    )}
                </div>
                <div className="timetable-controls">
                    <div className="control-group-inline">
                        <label htmlFor="dept-filter">Dept:</label>
                        <select id="dept-filter" className="form-control" value={filter.department} onChange={e => setFilter(f => ({ ...f, department: e.target.value }))}>
                            {DEPARTMENTS.map(dept => <option key={dept} value={dept}>{dept}</option>)}
                        </select>
                    </div>
                     <div className="control-group-inline">
                        <label htmlFor="year-filter">Year:</label>
                        <select id="year-filter" className="form-control" value={filter.year} onChange={e => setFilter(f => ({ ...f, year: e.target.value }))}>
                             {YEARS.map(year => <option key={year} value={year}>{year}</option>)}
                        </select>
                    </div>
                </div>
            </div>

            <div className="timetable-wrapper">
                <div className="timetable-grid">
                    <div className="grid-header"></div>
                    {DAYS.map(day => <div key={day} className="grid-header">{day}</div>)}

                    {settings.timeSlots.map((slot, timeIndex) => (
                        <React.Fragment key={timeIndex}>
                            <div className="time-slot">{slot}</div>
                            {DAYS.map(day => {
                                const entry = filteredTimetable.find(e => e.day === day && e.timeIndex === timeIndex);
                                const isAdmin = ['admin', 'hod', 'creator'].includes(currentUser.role);
                                return (
                                    <div
                                        key={`${day}-${timeIndex}`}
                                        className={`grid-cell ${entry?.type || ''} ${isAdmin ? 'editable' : ''}`}
                                        onClick={() => handleCellClick(day, timeIndex)}
                                        aria-label={`Timetable slot for ${day} at ${slot}. ${entry ? `${entry.subject}` : 'Empty'}`}
                                    >
                                        {entry && entry.type !== 'break' && (
                                            <>
                                                <span className="subject">{entry.subject}</span>
                                                {entry.faculty && <span className="faculty">{entry.faculty}</span>}
                                                {entry.room && <span className="faculty">{entry.room}</span>}
                                            </>
                                        )}
                                         {entry && entry.type === 'break' && (
                                            <span className="subject">{entry.subject}</span>
                                        )}
                                    </div>
                                );
                            })}
                        </React.Fragment>
                    ))}
                </div>
            </div>
            {editingCell && <TimetableModal entry={editingCell} onSave={handleSave} onClose={() => setEditingCell(null)} />}
            {isAIAssistantOpen && <AITimetableAssistant onClose={() => setAIAssistantOpen(false)} settings={settings} addNotification={addNotification} timetable={timetable} setTimetable={setTimetable} filter={filter} />}
        </>
    );
};

const AnnouncementsView = ({ announcements, setAnnouncements, currentUser, addNotification }: { announcements: Announcement[], setAnnouncements: React.Dispatch<React.SetStateAction<Announcement[]>>, currentUser: User, addNotification: (message: string, type: AppNotification['type']) => void }) => {
    const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
    const canManage = ['admin', 'hod', 'principal', 'creator'].includes(currentUser.role);

    const filteredAnnouncements = useMemo(() => {
        return announcements
            .filter(a => {
                if (currentUser.role === 'student') {
                    return (a.targetRole === 'all' || a.targetRole === 'student') && (a.targetDept === 'all' || a.targetDept === currentUser.dept);
                }
                if (currentUser.role === 'faculty') {
                     return (a.targetRole === 'all' || a.targetRole === 'faculty') && (a.targetDept === 'all' || a.targetDept === currentUser.dept);
                }
                return true; // Admins/HODs/Principals see all
            })
            .sort((a, b) => b.timestamp - a.timestamp);
    }, [announcements, currentUser]);

    const handleSave = (announcement: Announcement) => {
        if (announcements.find(a => a.id === announcement.id)) {
            setAnnouncements(prev => prev.map(a => a.id === announcement.id ? announcement : a));
            addNotification("Announcement updated successfully", "success");
        } else {
            setAnnouncements(prev => [announcement, ...prev]);
            addNotification("Announcement published successfully", "success");
        }
        setEditingAnnouncement(null);
    };

    const handleDelete = (id: string) => {
        if (window.confirm("Are you sure you want to delete this announcement?")) {
            setAnnouncements(prev => prev.filter(a => a.id !== id));
            addNotification("Announcement deleted", "info");
        }
    };
    
    const openEditor = () => {
        setEditingAnnouncement({
            id: `ann_${Date.now()}`,
            title: '',
            content: '',
            author: currentUser.name,
            authorId: currentUser.id,
            timestamp: Date.now(),
            targetRole: 'all',
            targetDept: 'all',
        });
    };

    const AnnouncementModal = ({ announcement, onSave, onClose }: { announcement: Announcement, onSave: (a: Announcement) => void, onClose: () => void }) => {
        const [formData, setFormData] = useState(announcement);
        const [isAiGenerating, setIsAiGenerating] = useState(false);

        const handleGenerateContent = async () => {
            if (!ai || !formData.title) {
                addNotification("Please enter a title first to generate content.", "warning");
                return;
            }
            setIsAiGenerating(true);
            try {
                const prompt = `Generate a formal announcement for a college portal. The title is "${formData.title}". Make it clear, concise, and professional.`;
                const response = await ai.models.generateContent({
                  model: 'gemini-2.5-flash',
                  contents: prompt,
                });
                setFormData(prev => ({...prev, content: response.text}));
            } catch (error) {
                console.error("AI content generation failed:", error);
                addNotification("Failed to generate content with AI.", "error");
            } finally {
                setIsAiGenerating(false);
            }
        };

        return (
            <Modal onClose={onClose} size="large">
                <form onSubmit={(e) => { e.preventDefault(); onSave(formData); }}>
                    <div className="modal-header">
                        <h3>{announcement.title ? 'Edit Announcement' : 'Create Announcement'}</h3>
                        <button type="button" onClick={onClose} className="modal-close-btn"><Icon name="close" /></button>
                    </div>
                    <div className="modal-body">
                        <div className="control-group">
                            <label htmlFor="ann-title">Title</label>
                            <input id="ann-title" type="text" className="form-control" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} required/>
                        </div>
                        <div className="control-group">
                            <label htmlFor="ann-content">Content</label>
                             <div className="ai-generator-section">
                                <button type="button" className="btn btn-secondary btn-sm" onClick={handleGenerateContent} disabled={isAiGenerating || !isAiEnabled}>
                                    {isAiGenerating ? <span className="spinner"></span> : <Icon name="sparkles" className="w-4 h-4"/>}
                                    {isAiGenerating ? 'Generating...' : 'Generate with AI'}
                                </button>
                                {!isAiEnabled && <p className="text-xs text-secondary mt-1">AI features disabled. API key not set.</p>}
                            </div>
                            <textarea id="ann-content" rows={8} className="form-control" value={formData.content} onChange={e => setFormData({...formData, content: e.target.value})} required></textarea>
                        </div>
                        <div className="form-grid">
                            <div className="control-group">
                                <label htmlFor="ann-target-role">Target Role</label>
                                <select id="ann-target-role" className="form-control" value={formData.targetRole} onChange={e => setFormData({...formData, targetRole: e.target.value as Announcement['targetRole']})}>
                                    <option value="all">All</option>
                                    <option value="student">Students</option>
                                    <option value="faculty">Faculty</option>
                                </select>
                            </div>
                             <div className="control-group">
                                <label htmlFor="ann-target-dept">Target Department</label>
                                <select id="ann-target-dept" className="form-control" value={formData.targetDept} onChange={e => setFormData({...formData, targetDept: e.target.value as Announcement['targetDept']})}>
                                   <option value="all">All Departments</option>
                                   {DEPARTMENTS.map(dept => <option key={dept} value={dept}>{dept}</option>)}
                                </select>
                            </div>
                        </div>
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary">Publish</button>
                    </div>
                </form>
            </Modal>
        );
    };

    return (
        <>
            <div className="view-header">
                <h2 className="text-2xl font-bold">Announcements</h2>
                {canManage && (
                    <button className="btn btn-primary" onClick={openEditor}>
                        <Icon name="plus" className="w-4 h-4" /> Create Announcement
                    </button>
                )}
            </div>
            {filteredAnnouncements.length > 0 ? (
                <div className="announcement-list">
                    {filteredAnnouncements.map(ann => (
                        <div key={ann.id} className="announcement-card stagger-item">
                            {canManage && (ann.authorId === currentUser.id || currentUser.role === 'admin') && (
                                <div className="card-actions-top">
                                    <button className="btn btn-secondary btn-sm" onClick={() => setEditingAnnouncement(ann)}><Icon name="edit" /></button>
                                    <button className="btn btn-danger-outline btn-sm" onClick={() => handleDelete(ann.id)}><Icon name="trash" /></button>
                                </div>
                            )}
                            <h3>{ann.title}</h3>
                            <div className="announcement-meta">
                                <span>By <strong>{ann.author}</strong></span>
                                <span>{new Date(ann.timestamp).toLocaleString()}</span>
                            </div>
                            <div className="announcement-content" dangerouslySetInnerHTML={{ __html: marked(ann.content) }}></div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="text-center text-secondary py-16">
                    <Icon name="announcements" className="w-16 h-16 mx-auto mb-4" />
                    <h3 className="text-xl font-semibold">No Announcements</h3>
                    <p>There are no announcements matching your role or department right now.</p>
                </div>
            )}
            {editingAnnouncement && <AnnouncementModal announcement={editingAnnouncement} onSave={handleSave} onClose={() => setEditingAnnouncement(null)} />}
        </>
    );
};

const AcademicCalendarView = ({ events, setEvents, currentUser, addNotification }: { events: CalendarEvent[], setEvents: React.Dispatch<React.SetStateAction<CalendarEvent[]>>, currentUser: User, addNotification: (message: string, type: AppNotification['type']) => void }) => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [filters, setFilters] = useState({ exam: true, holiday: true, event: true, deadline: true });

    useEffect(() => {
        const todayStr = new Date().toISOString().split('T')[0];
        const todaysEvents = events.filter(e => e.date === todayStr);
        todaysEvents.forEach(event => {
            addNotification(`Reminder: ${event.title} is today!`, 'info');
        });
    }, []); // Runs only once on mount

    const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
    const startDay = startOfMonth.getDay();
    const daysInMonth = endOfMonth.getDate();

    const days = Array.from({ length: startDay }, (_, i) => ({ day: null, date: null }));
    for (let i = 1; i <= daysInMonth; i++) {
        days.push({ day: i, date: new Date(currentDate.getFullYear(), currentDate.getMonth(), i) });
    }
    
    const eventsByDate = useMemo(() => {
        const map = new Map<string, CalendarEvent[]>();
        events.forEach(event => {
            if (!filters[event.type]) return;
            const dateStr = event.date;
            if (!map.has(dateStr)) {
                map.set(dateStr, []);
            }
            map.get(dateStr)!.push(event);
        });
        return map;
    }, [events, filters]);
    
    const handlePrevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    const handleNextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    const handleToday = () => setCurrentDate(new Date());

    const openModal = (event: CalendarEvent | null, date?: Date) => {
        if (date && ['admin', 'hod', 'principal'].includes(currentUser.role)) {
            setSelectedEvent({ id: `new_${Date.now()}`, date: date.toISOString().split('T')[0], title: '', type: 'event' });
            setIsModalOpen(true);
        } else if (event) {
            setSelectedEvent(event);
            setIsModalOpen(true);
        }
    };
    
    const handleSaveEvent = (eventData: CalendarEvent) => {
        if (events.find(e => e.id === eventData.id)) {
            setEvents(prev => prev.map(e => e.id === eventData.id ? eventData : e));
            addNotification('Event updated successfully!', 'success');
        } else {
            setEvents(prev => [...prev, { ...eventData, id: `evt_${Date.now()}` }]);
            addNotification('Event added successfully!', 'success');
        }
        setIsModalOpen(false);
    };

    const handleDeleteEvent = (eventId: string) => {
        setEvents(prev => prev.filter(e => e.id !== eventId));
        addNotification('Event deleted.', 'info');
        setIsModalOpen(false);
    };

    const handleFilterChange = (type: keyof typeof filters) => {
        setFilters(prev => ({ ...prev, [type]: !prev[type] }));
    };

    const CalendarEventModal = ({ event, onSave, onDelete, onClose }: { event: CalendarEvent, onSave: (e: CalendarEvent) => void, onDelete: (id: string) => void, onClose: () => void }) => {
        const [formData, setFormData] = useState(event);
        const isAdmin = ['admin', 'hod', 'principal'].includes(currentUser.role);

        return (
            <Modal onClose={onClose}>
                <form onSubmit={(e) => { e.preventDefault(); onSave(formData); }}>
                    <div className="modal-header">
                        <h3>{event.title ? 'Edit Event' : 'Add Event'}</h3>
                        <button type="button" onClick={onClose} className="modal-close-btn"><Icon name="close" /></button>
                    </div>
                    <div className="modal-body">
                        {isAdmin ? (
                            <>
                                <div className="control-group">
                                    <label htmlFor="event-title">Title</label>
                                    <input id="event-title" type="text" className="form-control" value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} required />
                                </div>
                                <div className="control-group">
                                    <label htmlFor="event-date">Date</label>
                                    <input id="event-date" type="date" className="form-control" value={formData.date} onChange={e => setFormData({ ...formData, date: e.target.value })} required />
                                </div>
                                <div className="control-group">
                                    <label htmlFor="event-type">Type</label>
                                    <select id="event-type" className="form-control" value={formData.type} onChange={e => setFormData({ ...formData, type: e.target.value as CalendarEvent['type'] })}>
                                        <option value="event">Event</option>
                                        <option value="exam">Exam</option>
                                        <option value="holiday">Holiday</option>
                                        <option value="deadline">Deadline</option>
                                    </select>
                                </div>
                            </>
                        ) : (
                           <>
                                <h4 className="text-xl font-semibold">{formData.title}</h4>
                                <p className="text-secondary mt-1">Date: {new Date(formData.date).toLocaleDateString()}</p>
                                <p className="mt-2"><span className={`status-badge status-${formData.type}`}>{formData.type}</span></p>
                           </>
                        )}
                    </div>
                    {isAdmin && (
                        <div className="modal-footer">
                            {event.title && <button type="button" className="btn btn-danger-outline" onClick={() => onDelete(event.id)}>Delete</button>}
                            <div>
                               <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
                               <button type="submit" className="btn btn-primary">Save</button>
                            </div>
                        </div>
                    )}
                </form>
            </Modal>
        );
    };

    return (
        <>
            <div className="view-header">
                <h2 className="text-2xl font-bold">Academic Calendar</h2>
                {['admin', 'hod', 'principal'].includes(currentUser.role) && (
                    <button className="btn btn-primary" onClick={() => openModal(null, new Date())}>
                        <Icon name="plus" className="w-4 h-4" /> Add Event
                    </button>
                )}
            </div>
            
            <div className="p-4 bg-secondary rounded-lg shadow-sm mb-4 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <button onClick={handlePrevMonth} className="p-2 rounded-full hover:bg-tertiary"><Icon name="chevron-left" className="w-5 h-5" /></button>
                    <span className="text-lg font-semibold w-32 text-center">{currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}</span>
                    <button onClick={handleNextMonth} className="p-2 rounded-full hover:bg-tertiary"><Icon name="chevron-right" className="w-5 h-5" /></button>
                    <button onClick={handleToday} className="btn btn-secondary btn-sm"><Icon name="today" className="w-4 h-4"/> Today</button>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                    {Object.keys(filters).map(key => (
                         <div key={key} className="control-group-inline">
                             <input type="checkbox" id={`filter-${key}`} checked={filters[key as keyof typeof filters]} onChange={() => handleFilterChange(key as keyof typeof filters)} className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"/>
                             <label htmlFor={`filter-${key}`} className="capitalize ml-2 text-sm">{key}</label>
                         </div>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-7 gap-1">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <div key={day} className="text-center font-bold text-secondary p-2">{day}</div>)}
                {days.map((d, i) => (
                    <div key={i} className={`h-32 border border-border-color bg-secondary rounded-md p-2 flex flex-col ${d.day ? 'cursor-pointer hover:bg-tertiary' : 'bg-tertiary'}`} onClick={() => d.date && openModal(null, d.date)}>
                        {d.day && <span className="font-semibold">{d.day}</span>}
                        <div className="flex-grow overflow-y-auto text-xs mt-1">
                           {d.date && eventsByDate.get(d.date.toISOString().split('T')[0])?.map(event => (
                               <div key={event.id} onClick={(e) => {e.stopPropagation(); openModal(event)}} className={`p-1 my-1 rounded-md text-white bg-opacity-80 cursor-pointer ${
                                   {exam: 'bg-red-500', holiday: 'bg-green-500', event: 'bg-blue-500', deadline: 'bg-yellow-500'}[event.type]
                               }`}>
                                   {event.title}
                               </div>
                           ))}
                        </div>
                    </div>
                ))}
            </div>
             {isModalOpen && selectedEvent && <CalendarEventModal event={selectedEvent} onSave={handleSaveEvent} onDelete={handleDeleteEvent} onClose={() => setIsModalOpen(false)} />}
        </>
    );
};

const SettingsView = ({ settings, setSettings, currentUser, addNotification }: { settings: AppSettings, setSettings: React.Dispatch<React.SetStateAction<AppSettings>>, currentUser: User, addNotification: (message: string, type: AppNotification['type']) => void }) => {
    const [theme, setTheme] = useState(settings.theme);
    const [activeTheme, setActiveTheme] = useState(settings.activeTheme);
    const [newTimeSlot, setNewTimeSlot] = useState("");
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");

    const handleSaveAppearance = () => {
        setSettings(s => ({ ...s, theme, activeTheme }));
        addNotification('Appearance settings saved!', 'success');
    };
    
    const handleAddTimeSlot = () => {
        if (newTimeSlot.trim()) {
            setSettings(s => ({ ...s, timeSlots: [...s.timeSlots, newTimeSlot.trim()] }));
            setNewTimeSlot("");
            addNotification('Time slot added.', 'success');
        }
    };
    
    const handleRemoveTimeSlot = (index: number) => {
        setSettings(s => ({ ...s, timeSlots: s.timeSlots.filter((_, i) => i !== index) }));
        addNotification('Time slot removed.', 'info');
    };
    
    const handlePasswordChange = (e: React.FormEvent) => {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
            addNotification('New passwords do not match.', 'error');
            return;
        }
        if (newPassword.length < 6) {
            addNotification('Password must be at least 6 characters long.', 'error');
            return;
        }
        console.log("Password changed for user:", currentUser.id);
        addNotification('Password changed successfully!', 'success');
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
    };

    return (
        <div className="flex flex-col gap-8">
            <div className="view-header"><h2 className="text-2xl font-bold">Settings</h2></div>
            <div className="grid md:grid-cols-2 gap-8">
                <div className="dashboard-card">
                    <h3 className="text-xl font-semibold mb-4 flex items-center gap-2"><Icon name="palette"/>Appearance</h3>
                    <div className="control-group">
                        <label>Mode</label>
                        <div className="flex gap-4">
                            <button onClick={() => setTheme('light')} className={`btn ${theme === 'light' ? 'btn-primary' : 'btn-secondary'}`}>Light</button>
                            <button onClick={() => setTheme('dark')} className={`btn ${theme === 'dark' ? 'btn-primary' : 'btn-secondary'}`}>Dark</button>
                        </div>
                    </div>
                    <div className="control-group">
                        <label>Theme</label>
                        <div className="theme-swatches">
                            {THEMES.map(t => (
                                <button
                                    key={t.name}
                                    className={`theme-swatch ${activeTheme === t.name ? 'active' : ''}`}
                                    style={{ backgroundColor: t.colors['--accent-primary'] }}
                                    onClick={() => setActiveTheme(t.name)}
                                    aria-label={`Select ${t.name} theme`}
                                >
                                    {activeTheme === t.name && <Icon name="check" className="w-5 h-5 text-white" />}
                                </button>
                            ))}
                        </div>
                    </div>
                    <button onClick={handleSaveAppearance} className="btn btn-primary mt-2">Save Appearance</button>
                </div>

                 <div className="dashboard-card">
                    <h3 className="text-xl font-semibold mb-4 flex items-center gap-2"><Icon name="user"/>Profile Management</h3>
                    <form onSubmit={handlePasswordChange}>
                        <div className="control-group">
                            <label htmlFor="current-password">Current Password</label>
                            <input type="password" id="current-password" className="form-control" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required/>
                        </div>
                        <div className="control-group">
                            <label htmlFor="new-password">New Password</label>
                            <input type="password" id="new-password" className="form-control" value={newPassword} onChange={e => setNewPassword(e.target.value)} required/>
                        </div>
                         <div className="control-group">
                            <label htmlFor="confirm-password">Confirm New Password</label>
                            <input type="password" id="confirm-password" className="form-control" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required/>
                        </div>
                        <button type="submit" className="btn btn-primary">Change Password</button>
                    </form>
                </div>
            </div>

            {['admin', 'creator'].includes(currentUser.role) && (
                 <div className="dashboard-card">
                     <h3 className="text-xl font-semibold mb-4 flex items-center gap-2"><Icon name="sliders"/>System Settings</h3>
                     <h4>Time Slot Management</h4>
                     <ul className="list-disc pl-5 my-2">
                        {settings.timeSlots.map((slot, index) => (
                           <li key={index} className="flex justify-between items-center mb-1">
                               <span>{slot}</span>
                               <button onClick={() => handleRemoveTimeSlot(index)} className="btn btn-danger-outline btn-sm">Remove</button>
                           </li>
                        ))}
                     </ul>
                     <div className="flex gap-2 mt-4">
                        <input type="text" className="form-control" value={newTimeSlot} onChange={e => setNewTimeSlot(e.target.value)} placeholder="e.g., 4:00 - 5:00"/>
                        <button onClick={handleAddTimeSlot} className="btn btn-primary">Add</button>
                     </div>
                 </div>
            )}
        </div>
    );
};

const UserManagementView = ({ users, setUsers, addNotification }: { users: User[], setUsers: React.Dispatch<React.SetStateAction<User[]>>, addNotification: (message: string, type: AppNotification['type']) => void }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [filters, setFilters] = useState({ role: 'all', dept: 'all', status: 'all' });
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [generatingSummaryFor, setGeneratingSummaryFor] = useState<string | null>(null);

    const handleFilterChange = (filterName: string, value: string) => {
        setFilters(prev => ({ ...prev, [filterName]: value }));
    };

    const handleToggleLock = (userId: string) => {
        const user = users.find(u => u.id === userId);
        if (user) {
            setUsers(prevUsers =>
                prevUsers.map(u =>
                    u.id === userId ? { ...u, isLocked: !u.isLocked } : u
                )
            );
            addNotification(`User '${user.name}' has been ${user.isLocked ? 'unlocked' : 'locked'}.`, 'info');
        }
    };
    
    const handleGenerateSummary = async (user: User) => {
        if (!ai) {
            addNotification("AI features are disabled.", "error");
            return;
        }
        setGeneratingSummaryFor(user.id);
        try {
            let promptContext = `User: ${user.name}, Role: ${user.role}, Department: ${user.dept}, Status: ${user.status}.`;
            if (user.role === 'student') {
                promptContext += ` Year: ${user.year}. Grades: ${JSON.stringify(user.grades || [])}. Attendance: ${JSON.stringify(user.attendance || {})}.`;
            }
            const prompt = `Generate a concise, one-paragraph summary for the following user, highlighting their academic standing, role, and any notable points (e.g., high-achiever, poor attendance, pending status). Context: ${promptContext}`;
            
            const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
            setUsers(prev => prev.map(u => u.id === user.id ? { ...u, aiSummary: response.text } : u));
            addNotification(`AI summary generated for ${user.name}.`, 'success');
        } catch (error) {
            console.error("AI summary generation failed:", error);
            addNotification("Failed to generate AI summary.", "error");
        } finally {
            setGeneratingSummaryFor(null);
        }
    };

    const filteredUsers = useMemo(() => {
        return users.filter(user => {
            if (user.role === 'creator') return false; // Exclude creator from management
            const nameMatch = user.name.toLowerCase().includes(searchTerm.toLowerCase());
            const roleMatch = filters.role === 'all' || user.role === filters.role;
            const deptMatch = filters.dept === 'all' || user.dept === filters.dept;
            const statusMatch = filters.status === 'all' || user.status === filters.status;
            return nameMatch && roleMatch && deptMatch && statusMatch;
        }).sort((a,b) => a.name.localeCompare(b.name));
    }, [users, searchTerm, filters]);
    
    const handleSaveUser = (updatedUser: User) => {
        setUsers(prev => prev.map(u => u.id === updatedUser.id ? updatedUser : u));
        addNotification(`User '${updatedUser.name}' has been updated.`, 'success');
        setEditingUser(null);
    };

    const UserEditModal = ({ user, onSave, onClose }: { user: User, onSave: (u: User) => void, onClose: () => void }) => {
        const [formData, setFormData] = useState(user);
        
        const handleSubmit = (e: React.FormEvent) => {
            e.preventDefault();
            onSave(formData);
        };

        return (
            <Modal onClose={onClose}>
                <form onSubmit={handleSubmit}>
                    <div className="modal-header">
                        <h3>Edit User: {user.name}</h3>
                        <button type="button" onClick={onClose} className="modal-close-btn"><Icon name="close" /></button>
                    </div>
                    <div className="modal-body">
                        <div className="control-group">
                            <label htmlFor="edit-name">Name</label>
                            <input id="edit-name" type="text" className="form-control" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required />
                        </div>
                         <div className="form-grid">
                            <div className="control-group">
                                <label htmlFor="edit-role">Role</label>
                                <select id="edit-role" className="form-control" value={formData.role} onChange={e => setFormData({...formData, role: e.target.value as UserRole})}>
                                    {ROLES.map(role => <option key={role} value={role}>{role.charAt(0).toUpperCase() + role.slice(1)}</option>)}
                                </select>
                            </div>
                            <div className="control-group">
                                <label htmlFor="edit-dept">Department</label>
                                <select id="edit-dept" className="form-control" value={formData.dept} onChange={e => setFormData({...formData, dept: e.target.value})}>
                                    {DEPARTMENTS.map(dept => <option key={dept} value={dept}>{dept}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="form-grid">
                            <div className="control-group">
                                <label htmlFor="edit-status">Status</label>
                                <select id="edit-status" className="form-control" value={formData.status} onChange={e => setFormData({...formData, status: e.target.value as User['status']})}>
                                    <option value="active">Active</option>
                                    <option value="pending_approval">Pending Approval</option>
                                    <option value="rejected">Rejected</option>
                                </select>
                            </div>
                            {formData.role === 'student' && (
                                <div className="control-group">
                                    <label htmlFor="edit-year">Year</label>
                                    <select id="edit-year" className="form-control" value={formData.year} onChange={e => setFormData({...formData, year: e.target.value})}>
                                        {YEARS.map(year => <option key={year} value={year}>{year}</option>)}
                                    </select>
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary">Save Changes</button>
                    </div>
                </form>
            </Modal>
        );
    };

    return (
        <>
            <div className="view-header">
                <h2 className="text-2xl font-bold">User Management</h2>
            </div>

            <div className="dashboard-card mb-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="control-group !mb-0">
                        <label htmlFor="search-name">Search by Name</label>
                        <input id="search-name" type="text" className="form-control" placeholder="e.g., John Doe" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                    </div>
                    <div className="control-group !mb-0">
                        <label htmlFor="filter-role">Filter by Role</label>
                        <select id="filter-role" className="form-control" value={filters.role} onChange={e => handleFilterChange('role', e.target.value)}>
                            <option value="all">All Roles</option>
                            {ROLES.map(role => <option key={role} value={role}>{role.charAt(0).toUpperCase() + role.slice(1)}</option>)}
                        </select>
                    </div>
                    <div className="control-group !mb-0">
                        <label htmlFor="filter-dept">Filter by Department</label>
                        <select id="filter-dept" className="form-control" value={filters.dept} onChange={e => handleFilterChange('dept', e.target.value)}>
                            <option value="all">All Departments</option>
                            {DEPARTMENTS.map(dept => <option key={dept} value={dept}>{dept}</option>)}
                        </select>
                    </div>
                    <div className="control-group !mb-0">
                        <label htmlFor="filter-status">Filter by Status</label>
                        <select id="filter-status" className="form-control" value={filters.status} onChange={e => handleFilterChange('status', e.target.value)}>
                            <option value="all">All Statuses</option>
                            <option value="active">Active</option>
                            <option value="pending_approval">Pending</option>
                            <option value="rejected">Rejected</option>
                        </select>
                    </div>
                </div>
            </div>

            <div className="table-wrapper">
                <table className="entry-list-table">
                    <thead>
                        <tr>
                            <th>User</th>
                            <th>Role</th>
                            <th>Department</th>
                            <th>Status</th>
                            <th>AI Summary</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredUsers.length > 0 ? filteredUsers.map(user => (
                            <tr key={user.id} className={user.isLocked ? 'locked' : ''}>
                                <td>
                                    <div className="flex items-center gap-3">
                                        <div className="avatar">{user.name.charAt(0)}</div>
                                        <div>
                                            <div className="font-bold flex items-center gap-2">
                                                {user.name}
                                                {user.isLocked && <Icon name="lock" className="w-4 h-4 icon-danger" />}
                                            </div>
                                            <div className="text-sm text-secondary">{user.id}</div>
                                        </div>
                                    </div>
                                </td>
                                <td><span className={`role-badge role-${user.role.replace(/ /g, '-')}`}>{user.role} {user.role === 'student' && `(${user.year})`}</span></td>
                                <td>{user.dept}</td>
                                <td><span className={`status-badge status-${user.status}`}>{user.status.replace('_', ' ')}</span></td>
                                <td className="ai-summary-cell">
                                    {user.aiSummary && <p className="text-xs text-secondary">{user.aiSummary}</p>}
                                    <button
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => handleGenerateSummary(user)}
                                        disabled={generatingSummaryFor === user.id}
                                    >
                                        {generatingSummaryFor === user.id ? <span className="spinner"></span> : <Icon name="sparkles" className="w-4 h-4" />}
                                    </button>
                                </td>
                                <td>
                                    <button className="btn btn-secondary btn-sm" onClick={() => setEditingUser(user)}>
                                        <Icon name="edit" className="w-4 h-4"/>
                                    </button>
                                    <button 
                                        className={`btn btn-sm ${user.isLocked ? 'btn-secondary' : 'btn-danger-outline'}`} 
                                        onClick={() => handleToggleLock(user.id)}
                                    >
                                        <Icon name={user.isLocked ? 'key' : 'lock'} className="w-4 h-4"/> 
                                    </button>
                                </td>
                            </tr>
                        )) : (
                            <tr>
                                <td colSpan={6} className="text-center py-8 text-secondary">
                                    No users found matching your criteria.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {editingUser && <UserEditModal user={editingUser} onSave={handleSaveUser} onClose={() => setEditingUser(null)} />}
        </>
    );
};

const CourseFilesView = ({ courseFiles, setCourseFiles, currentUser, addNotification }: { courseFiles: CourseFile[], setCourseFiles: React.Dispatch<React.SetStateAction<CourseFile[]>>, currentUser: User, addNotification: (message: string, type: AppNotification['type']) => void }) => {
    const [selectedCourseFile, setSelectedCourseFile] = useState<CourseFile | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    
    const isReviewer = ['admin', 'hod', 'principal'].includes(currentUser.role);
    const isFaculty = ['faculty', 'hod', 'principal', 'admin', 'creator'].includes(currentUser.role);

    const filteredFiles = useMemo(() => {
        if (isReviewer) {
            return courseFiles.filter(cf => 
                (currentUser.role === 'admin' || currentUser.role === 'principal' || cf.department === currentUser.dept)
            ).sort((a,b) => {
                const statusOrder = { 'pending_review': 1, 'needs_revision': 2, 'approved': 3 };
                return statusOrder[a.status] - statusOrder[b.status] || b.submittedAt - a.submittedAt;
            });
        }
        return courseFiles.filter(cf => cf.facultyId === currentUser.id).sort((a,b) => b.submittedAt - a.submittedAt);
    }, [courseFiles, currentUser, isReviewer]);
    
    const handleOpenFile = (file: CourseFile) => {
        setSelectedCourseFile(file);
        setIsModalOpen(true);
    };

    const handleNewFile = () => {
        setSelectedCourseFile({
            id: `new_${Date.now()}`,
            facultyId: currentUser.id,
            facultyName: currentUser.name,
            department: currentUser.dept,
            subject: '',
            semester: '1',
            files: [],
            status: 'pending_review',
            submittedAt: Date.now(),
        });
        setIsModalOpen(true);
    };
    
    const handleSaveFile = (file: CourseFile) => {
        const fileToSave = { ...file, submittedAt: Date.now(), status: 'pending_review' as CourseFile['status'] };
        if (file.id.startsWith('new_')) {
            setCourseFiles(prev => [{ ...fileToSave, id: `cf_${Date.now()}` }, ...prev]);
            addNotification('Course file submitted for review.', 'success');
        } else {
            setCourseFiles(prev => prev.map(cf => cf.id === file.id ? fileToSave : cf));
            addNotification('Course file updated and re-submitted.', 'success');
        }
        setIsModalOpen(false);
    };

    return (
        <>
            <div className="view-header">
                <h2 className="text-2xl font-bold">Course Files</h2>
                {isFaculty && (
                    <button className="btn btn-primary" onClick={handleNewFile}>
                        <Icon name="plus" className="w-4 h-4" /> Submit New File
                    </button>
                )}
            </div>
            
            <div className="course-files-grid">
                {filteredFiles.length > 0 ? filteredFiles.map(cf => (
                    <div key={cf.id} className="course-file-card stagger-item" onClick={() => handleOpenFile(cf)}>
                        <div className="course-file-card-header">
                            <span className={`status-badge status-${cf.status}`}>{cf.status.replace('_', ' ')}</span>
                        </div>
                        <div className="course-file-card-body">
                             <h3 className="font-bold">{cf.subject}</h3>
                             <p className="text-secondary text-sm">Semester {cf.semester} &bull; {cf.department}</p>
                             <p className="text-secondary text-xs mt-2">Submitted by {isReviewer ? cf.facultyName : 'you'} on {new Date(cf.submittedAt).toLocaleDateString()}</p>
                        </div>
                        <div className="course-file-card-footer">
                             <div className="flex items-center gap-2">
                                <Icon name="courseFiles" className="w-4 h-4 text-secondary"/>
                                <span className="text-xs text-secondary">{cf.files.length} file(s)</span>
                             </div>
                        </div>
                    </div>
                )) : (
                    <div className="text-center text-secondary py-16 col-span-full">
                        <Icon name="courseFiles" className="w-16 h-16 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold">No Course Files</h3>
                        <p>{isReviewer ? "There are no course files to review." : "You have not submitted any course files yet."}</p>
                    </div>
                )}
            </div>
            {isModalOpen && selectedCourseFile && (
                <CourseFileModal 
                    courseFile={selectedCourseFile}
                    onSave={handleSaveFile}
                    onClose={() => setIsModalOpen(false)}
                    currentUser={currentUser}
                    addNotification={addNotification}
                    setCourseFiles={setCourseFiles}
                />
            )}
        </>
    );
};

const CourseFileModal = ({ courseFile, onSave, onClose, currentUser, addNotification, setCourseFiles }: { courseFile: CourseFile, onSave: (cf: CourseFile) => void, onClose: () => void, currentUser: User, addNotification: (m: string, t: AppNotification['type']) => void, setCourseFiles: React.Dispatch<React.SetStateAction<CourseFile[]>> }) => {
    const [formData, setFormData] = useState(courseFile);
    const [newFileName, setNewFileName] = useState("");
    const [newFileType, setNewFileType] = useState<'syllabus' | 'notes' | 'quiz'>('notes');
    const [isGeneratingReview, setIsGeneratingReview] = useState(false);
    
    const isOwner = formData.facultyId === currentUser.id;
    const isReviewer = ['admin', 'hod', 'principal'].includes(currentUser.role);
    const canEdit = isOwner && formData.status !== 'approved';
    const canReview = isReviewer && !isOwner;

    const handleAddFile = (e: React.FormEvent) => {
        e.preventDefault();
        if (newFileName.trim()) {
            setFormData(prev => ({...prev, files: [...prev.files, { name: newFileName.trim(), type: newFileType }]}));
            setNewFileName("");
        }
    };
    
    const handleRemoveFile = (index: number) => {
        setFormData(prev => ({...prev, files: prev.files.filter((_, i) => i !== index)}));
    };
    
    const handleStatusChange = (newStatus: CourseFile['status']) => {
        const updatedFile = {...formData, status: newStatus};
        setCourseFiles(prev => prev.map(cf => cf.id === updatedFile.id ? updatedFile : cf));
        addNotification(`Submission status changed to ${newStatus.replace('_', ' ')}.`, 'success');
        onClose();
    };

    const handleGenerateAiReview = async () => {
        if (!ai) {
            addNotification("AI features are disabled.", "error");
            return;
        }
        setIsGeneratingReview(true);
        try {
            const prompt = `You are an academic quality assurance expert reviewing a course file submission for a college. Submission Details: Subject: ${formData.subject}, Semester: ${formData.semester}, Department: ${formData.department}, Faculty: ${formData.facultyName}, Files: ${formData.files.map(f => `${f.name} (${f.type})`).join(', ')}. Based on these details, provide a concise summary, 3-5 actionable suggestions for improvement (e.g., "Consider adding a quiz for Unit 2"), and identify one potential grammatical correction in a hypothetical document. Your tone should be constructive and helpful.`;
            const responseSchema = {
                type: Type.OBJECT, properties: {
                    summary: { type: Type.STRING },
                    suggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
                    corrections: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { original: { type: Type.STRING }, corrected: { type: Type.STRING } } } },
                }
            };
            const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt, config: { responseMimeType: 'application/json', responseSchema } });
            const reviewData = JSON.parse(response.text);
            const newAiReview: CourseFile['aiReview'] = { ...reviewData, status: 'complete', timestamp: Date.now() };
            const updatedFile = { ...formData, aiReview: newAiReview };
            setFormData(updatedFile);
            setCourseFiles(prev => prev.map(cf => cf.id === updatedFile.id ? updatedFile : cf));
        } catch (e) {
            console.error("AI review generation failed:", e);
            addNotification("Failed to generate AI review.", "error");
        } finally {
            setIsGeneratingReview(false);
        }
    };

    return (
        <Modal onClose={onClose} size="large">
            <div className="modal-header">
                <h3>{courseFile.id.startsWith('new_') ? 'New Course File Submission' : 'View Course File'}</h3>
                <button type="button" onClick={onClose} className="modal-close-btn"><Icon name="close" /></button>
            </div>
            <div className="modal-body">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        {canEdit ? (
                            <form onSubmit={(e) => { e.preventDefault(); onSave(formData); }}>
                                <div className="control-group">
                                    <label>Subject</label>
                                    <input type="text" className="form-control" value={formData.subject} onChange={e => setFormData({...formData, subject: e.target.value})} required />
                                </div>
                                <div className="control-group">
                                    <label>Semester</label>
                                    <select className="form-control" value={formData.semester} onChange={e => setFormData({...formData, semester: e.target.value})}>
                                        {Array.from({length: 8}, (_, i) => i + 1).map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                </div>
                                <div className="control-group">
                                    <label>Files</label>
                                    <ul className="mb-2 list-disc pl-5">
                                        {formData.files.map((file, index) => (
                                            <li key={index}> {file.name} ({file.type}) <button type="button" onClick={() => handleRemoveFile(index)} className="text-red-500 ml-2">&times;</button></li>
                                        ))}
                                    </ul>
                                    <div className="flex gap-2">
                                        <input type="text" className="form-control" placeholder="File name (e.g., Unit1.pdf)" value={newFileName} onChange={e => setNewFileName(e.target.value)} />
                                        <select className="form-control" value={newFileType} onChange={e => setNewFileType(e.target.value as any)}>
                                            <option value="syllabus">Syllabus</option>
                                            <option value="notes">Notes</option>
                                            <option value="quiz">Quiz</option>
                                        </select>
                                        <button type="button" onClick={handleAddFile} className="btn btn-secondary">Add</button>
                                    </div>
                                </div>
                            </form>
                        ) : (
                            <div>
                                <h4 className="text-lg font-semibold">{formData.subject}</h4>
                                <p className="text-secondary">Semester {formData.semester} &bull; {formData.department}</p>
                                <p className="text-secondary text-sm mt-2">Submitted by: {formData.facultyName}</p>
                                <hr className="my-4"/>
                                <h5 className="font-semibold mb-2">Submitted Files</h5>
                                <ul className="list-disc pl-5">
                                    {formData.files.map((file, i) => <li key={i}>{file.name} <span className="text-secondary text-sm">({file.type})</span></li>)}
                                </ul>
                            </div>
                        )}
                    </div>
                    <div>
                        {isReviewer && (
                             <div className="ai-review-panel">
                                <h4 className="flex items-center gap-2 font-semibold"><Icon name="sparkles" /> AI Quality Review</h4>
                                {formData.aiReview ? (
                                    <div className="mt-2 text-sm">
                                        <strong>Summary:</strong><p className="text-secondary">{formData.aiReview.summary}</p>
                                        <strong className="mt-2 block">Suggestions:</strong>
                                        <ul className="list-disc pl-5 text-secondary">
                                            {formData.aiReview.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                                        </ul>
                                        {formData.aiReview.corrections && formData.aiReview.corrections.length > 0 && <>
                                            <strong className="mt-2 block">Example Correction:</strong>
                                            <div className="text-secondary">
                                                <p><span className="line-through">{formData.aiReview.corrections[0].original}</span></p>
                                                <p className="text-green-600">{formData.aiReview.corrections[0].corrected}</p>
                                            </div>
                                        </>}
                                    </div>
                                ) : (
                                    <div className="text-center p-4">
                                        <p className="text-secondary text-sm mb-2">No review generated yet.</p>
                                        <button className="btn btn-primary btn-sm" onClick={handleGenerateAiReview} disabled={isGeneratingReview || !isAiEnabled}>
                                             {isGeneratingReview ? <><span className="spinner"></span> Generating...</> : 'Generate AI Review'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
            <div className="modal-footer">
                <span className={`status-badge status-${formData.status}`}>{formData.status.replace('_', ' ')}</span>
                <div>
                {canEdit && <button type="button" className="btn btn-primary" onClick={() => onSave(formData)}>Save & Submit</button>}
                {canReview && formData.status === 'pending_review' && (
                    <>
                        <button type="button" className="btn btn-secondary" onClick={() => handleStatusChange('needs_revision')}>Request Revision</button>
                        <button type="button" className="btn btn-success" onClick={() => handleStatusChange('approved')}>Approve</button>
                    </>
                )}
                <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
                </div>
            </div>
        </Modal>
    );
};

const SecurityView = ({ securityAlerts, setSecurityAlerts, users, setUsers, addNotification }: { securityAlerts: SecurityAlert[], setSecurityAlerts: React.Dispatch<React.SetStateAction<SecurityAlert[]>>, users: User[], setUsers: React.Dispatch<React.SetStateAction<User[]>>, addNotification: (m: string, t: AppNotification['type']) => void }) => {
    const [selectedAlert, setSelectedAlert] = useState<SecurityAlert | null>(null);
    const [filters, setFilters] = useState({ severity: 'all', status: 'all' });
    
    const stats = useMemo(() => {
        const unresolved = securityAlerts.filter(a => !a.isResolved).length;
        const severities = securityAlerts.reduce((acc, alert) => {
            acc[alert.severity] = (acc[alert.severity] || 0) + 1;
            return acc;
        }, {} as Record<SecurityAlert['severity'], number>);
        return { total: securityAlerts.length, unresolved, ...severities };
    }, [securityAlerts]);

    const filteredAlerts = useMemo(() => {
        return securityAlerts.filter(alert => {
            const severityMatch = filters.severity === 'all' || alert.severity === filters.severity;
            const statusMatch = filters.status === 'all' || (filters.status === 'resolved' ? alert.isResolved : !alert.isResolved);
            return severityMatch && statusMatch;
        }).sort((a,b) => b.timestamp - a.timestamp);
    }, [securityAlerts, filters]);

    const handleFilterChange = (filterName: string, value: string) => {
        setFilters(prev => ({...prev, [filterName]: value}));
    };

    const toggleResolve = (alertId: string, isResolved: boolean) => {
        setSecurityAlerts(prev => prev.map(a => a.id === alertId ? { ...a, isResolved: !isResolved } : a));
        addNotification(`Alert marked as ${!isResolved ? 'resolved' : 'unresolved'}.`, 'info');
        setSelectedAlert(prev => prev ? { ...prev, isResolved: !isResolved } : null);
    };

    const handleExecuteAction = (alert: SecurityAlert) => {
        if (!alert.responsePlan || !alert.relatedUserId) return;

        const { recommendedAction, investigation } = alert.responsePlan;
        if (recommendedAction === 'LOCK_USER') {
            const userToLock = users.find(u => u.id === alert.relatedUserId);
            if (userToLock) {
                setUsers(prev => prev.map(u => u.id === alert.relatedUserId ? { ...u, isLocked: true } : u));
                addNotification(`Action executed: User '${userToLock.name}' has been locked.`, 'success');
            } else {
                addNotification('Could not find the user to lock.', 'error');
            }
        } else {
            addNotification(`Action '${recommendedAction}' noted for monitoring.`, 'info');
        }
    };
    
    const AlertModal = ({ alert, onClose }: { alert: SecurityAlert, onClose: () => void }) => {
        const relatedUser = users.find(u => u.id === alert.relatedUserId);
        return (
            <Modal onClose={onClose} size="large">
                <div className="modal-header">
                    <h3>Alert Details: {alert.title}</h3>
                    <button type="button" onClick={onClose} className="modal-close-btn"><Icon name="close" /></button>
                </div>
                <div className="modal-body">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div><strong>Status:</strong> <span className={`status-badge ${alert.isResolved ? 'status-success' : 'status-danger'}`}>{alert.isResolved ? 'Resolved' : 'Unresolved'}</span></div>
                        <div><strong>Severity:</strong> <span className={`status-badge status-${alert.severity}`}>{alert.severity}</span></div>
                        <div><strong>Timestamp:</strong> {new Date(alert.timestamp).toLocaleString()}</div>
                        {relatedUser && <div><strong>Related User:</strong> {relatedUser.name} ({relatedUser.id})</div>}
                    </div>
                    <p className="text-secondary mb-4">{alert.description}</p>
                    {alert.responsePlan && (
                        <div className="response-plan">
                            <h4>Response Plan</h4>
                            <p><strong>Containment:</strong> {alert.responsePlan.containment}</p>
                            <p><strong>Investigation:</strong> {alert.responsePlan.investigation}</p>
                            <p><strong>Recovery:</strong> {alert.responsePlan.recovery}</p>
                             {alert.responsePlan.recommendedAction !== 'NONE' && (
                                <div className="recommended-action">
                                    <strong>Recommended Action:</strong>
                                    <span>{alert.responsePlan.recommendedAction.replace('_', ' ')}</span>
                                    <button 
                                        className={`btn btn-sm ${alert.responsePlan.recommendedAction === 'LOCK_USER' ? 'btn-danger' : 'btn-secondary'}`}
                                        onClick={() => handleExecuteAction(alert)}>
                                            Execute Action
                                    </button>
                                </div>
                             )}
                        </div>
                    )}
                </div>
                <div className="modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
                    <button type="button" className={`btn ${alert.isResolved ? 'btn-secondary' : 'btn-success'}`} onClick={() => toggleResolve(alert.id, alert.isResolved)}>
                        {alert.isResolved ? 'Re-open Alert' : 'Mark as Resolved'}
                    </button>
                </div>
            </Modal>
        );
    };

    return (
        <>
            <div className="view-header"><h2 className="text-2xl font-bold">Security Center</h2></div>
            <div className="security-stats">
                <div className="security-stat-card"><h4>Total Alerts</h4><p>{stats.total}</p></div>
                <div className="security-stat-card unresolved"><h4>Unresolved</h4><p>{stats.unresolved}</p></div>
                <div className="security-stat-card severity-critical"><h4>Critical</h4><p>{stats.critical || 0}</p></div>
                <div className="security-stat-card severity-high"><h4>High</h4><p>{stats.high || 0}</p></div>
                <div className="security-stat-card severity-medium"><h4>Medium</h4><p>{stats.medium || 0}</p></div>
            </div>
            <div className="dashboard-card mb-6">
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="control-group !mb-0">
                        <label htmlFor="filter-severity">Filter by Severity</label>
                        <select id="filter-severity" className="form-control" value={filters.severity} onChange={e => handleFilterChange('severity', e.target.value)}>
                            <option value="all">All Severities</option>
                            <option value="critical">Critical</option>
                            <option value="high">High</option>
                            <option value="medium">Medium</option>
                            <option value="low">Low</option>
                        </select>
                    </div>
                    <div className="control-group !mb-0">
                        <label htmlFor="filter-status">Filter by Status</label>
                        <select id="filter-status" className="form-control" value={filters.status} onChange={e => handleFilterChange('status', e.target.value)}>
                            <option value="all">All</option>
                            <option value="unresolved">Unresolved</option>
                            <option value="resolved">Resolved</option>
                        </select>
                    </div>
                 </div>
            </div>
            <div className="alert-list">
                {filteredAlerts.length > 0 ? filteredAlerts.map(alert => (
                    <div key={alert.id} className={`alert-card severity-${alert.severity} ${alert.isResolved ? 'resolved' : ''}`} onClick={() => setSelectedAlert(alert)}>
                        <div className="alert-card-header">
                             <h3 className="font-bold">{alert.title}</h3>
                             <span className={`status-badge status-${alert.severity}`}>{alert.severity}</span>
                        </div>
                        <p className="text-secondary text-sm my-2">{alert.description}</p>
                        <div className="alert-card-footer">
                            <span className="text-xs text-secondary">{new Date(alert.timestamp).toLocaleString()}</span>
                            <span className={`status-badge ${alert.isResolved ? 'status-success' : 'status-danger'}`}>{alert.isResolved ? 'Resolved' : 'Unresolved'}</span>
                        </div>
                    </div>
                )) : (
                    <div className="text-center text-secondary py-16">
                        <Icon name="security" className="w-16 h-16 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold">No Alerts Found</h3>
                        <p>There are no security alerts matching your filters.</p>
                    </div>
                )}
            </div>
            {selectedAlert && <AlertModal alert={selectedAlert} onClose={() => setSelectedAlert(null)} />}
        </>
    );
};

const ResourceModal = ({ resource, onSave, onClose, addNotification }: { resource: Resource, onSave: (r: Resource) => void, onClose: () => void, addNotification: (message: string, type: AppNotification['type']) => void }) => {
    const [formData, setFormData] = useState(resource);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if(!formData.name || !formData.subject) {
            addNotification("Please fill in the resource name and subject.", "error");
            return;
        }
        onSave(formData);
    };
    
    return (
        <Modal onClose={onClose}>
            <form onSubmit={handleSubmit}>
                <div className="modal-header">
                    <h3>{resource.id.startsWith('new_') ? 'Upload Resource' : 'Edit Resource'}</h3>
                    <button type="button" onClick={onClose} className="modal-close-btn"><Icon name="close" /></button>
                </div>
                <div className="modal-body">
                     <div className="control-group">
                        <label htmlFor="res-name">Resource Name</label>
                        <input id="res-name" type="text" className="form-control" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="e.g., Chapter 1 Notes.pdf" required />
                    </div>
                    <div className="control-group">
                        <label htmlFor="res-subject">Subject</label>
                        <input id="res-subject" type="text" className="form-control" value={formData.subject} onChange={e => setFormData({...formData, subject: e.target.value})} placeholder="e.g., Data Structures" required />
                    </div>
                    <div className="form-grid">
                        <div className="control-group">
                            <label htmlFor="res-type">Type</label>
                            <select id="res-type" className="form-control" value={formData.type} onChange={e => setFormData({...formData, type: e.target.value as Resource['type']})}>
                                <option value="notes">Notes</option>
                                <option value="book">Book</option>
                                <option value="project">Project</option>
                                <option value="lab">Lab Manual</option>
                                <option value="other">Other</option>
                            </select>
                        </div>
                         <div className="control-group">
                            <label htmlFor="res-dept">Department</label>
                            <select id="res-dept" className="form-control" value={formData.department} onChange={e => setFormData({...formData, department: e.target.value})}>
                               {DEPARTMENTS.map(dept => <option key={dept} value={dept}>{dept}</option>)}
                            </select>
                        </div>
                    </div>
                </div>
                <div className="modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
                    <button type="submit" className="btn btn-primary">Save Resource</button>
                </div>
            </form>
        </Modal>
    );
};

const QuizModal = ({ resource, onClose, addNotification }: { resource: Resource; onClose: () => void; addNotification: (m: string, t: AppNotification['type']) => void; }) => {
    const [quizState, setQuizState] = useState<'loading' | 'active' | 'finished'>('loading');
    const [questions, setQuestions] = useState<QuizQuestion[]>([]);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
    const [score, setScore] = useState(0);

    useEffect(() => {
        const fetchQuiz = async () => {
            if (!ai) {
                addNotification("AI features are disabled.", "error");
                onClose();
                return;
            }
            try {
                const prompt = `Generate a 5-question multiple-choice quiz about "${resource.subject}". Each question should have 4 options and a clear correct answer.`;
                const quizSchema = {
                    type: Type.OBJECT,
                    properties: {
                        questions: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    question: { type: Type.STRING },
                                    options: { type: Type.ARRAY, items: { type: Type.STRING } },
                                    correctAnswerIndex: { type: Type.INTEGER },
                                },
                            },
                        },
                    },
                };
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: prompt,
                    config: { responseMimeType: 'application/json', responseSchema: quizSchema },
                });
                
                const quizData = JSON.parse(response.text);
                if (quizData.questions && quizData.questions.length > 0) {
                    setQuestions(quizData.questions);
                    setQuizState('active');
                } else {
                    throw new Error("Invalid quiz data received.");
                }
            } catch (error) {
                console.error("Failed to generate quiz:", error);
                addNotification("Could not generate a quiz for this resource.", "error");
                onClose();
            }
        };
        fetchQuiz();
    }, [resource, addNotification, onClose]);

    const handleAnswerSelect = (answerIndex: number) => {
        if (selectedAnswer !== null) return; // Prevent changing answer
        setSelectedAnswer(answerIndex);
        if (answerIndex === questions[currentQuestionIndex].correctAnswerIndex) {
            setScore(prev => prev + 1);
        }
    };

    const handleNextQuestion = () => {
        if (currentQuestionIndex < questions.length - 1) {
            setCurrentQuestionIndex(prev => prev + 1);
            setSelectedAnswer(null);
        } else {
            setQuizState('finished');
        }
    };
    
    const handleRetake = () => {
        setScore(0);
        setCurrentQuestionIndex(0);
        setSelectedAnswer(null);
        setQuizState('loading');
        // Re-fetch questions for a new quiz
        const fetchQuiz = async () => {
             if (!ai) return;
             try {
                const prompt = `Generate a NEW 5-question multiple-choice quiz about "${resource.subject}".`;
                const quizSchema = { /* same schema */ type: Type.OBJECT, properties: { questions: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { question: { type: Type.STRING }, options: { type: Type.ARRAY, items: { type: Type.STRING } }, correctAnswerIndex: { type: Type.INTEGER } } } } } };
                const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt, config: { responseMimeType: 'application/json', responseSchema: quizSchema } });
                const quizData = JSON.parse(response.text);
                setQuestions(quizData.questions);
                setQuizState('active');
             } catch(e) { onClose(); }
        };
        fetchQuiz();
    };

    const currentQuestion = questions[currentQuestionIndex];

    return (
        <Modal onClose={onClose} size="large">
            <div className="modal-header">
                <h3>Quiz: {resource.name}</h3>
                <button type="button" onClick={onClose} className="modal-close-btn"><Icon name="close" /></button>
            </div>
            <div className="modal-body quiz-modal-content">
                {quizState === 'loading' && (
                    <div className="spinner-container">
                        <div className="spinner"></div>
                        <p className="ml-4 text-secondary">Generating your quiz...</p>
                    </div>
                )}
                {quizState === 'active' && currentQuestion && (
                    <>
                        <div className="quiz-progress-header">
                            <p>Question {currentQuestionIndex + 1} of {questions.length}</p>
                            <div className="quiz-progress-bar-container">
                                <div className="quiz-progress-bar" style={{ width: `${((currentQuestionIndex + 1) / questions.length) * 100}%` }}></div>
                            </div>
                        </div>
                        <div className="quiz-question-container">
                            <h4 className="text-xl font-semibold">{currentQuestion.question}</h4>
                            <div className="quiz-options">
                                {currentQuestion.options.map((option, index) => {
                                    const isCorrect = index === currentQuestion.correctAnswerIndex;
                                    const isSelected = selectedAnswer === index;
                                    let btnClass = 'quiz-option-btn';
                                    if (selectedAnswer !== null) {
                                        if (isCorrect) btnClass += ' correct';
                                        else if (isSelected) btnClass += ' incorrect';
                                    } else if (isSelected) {
                                        btnClass += ' selected';
                                    }
                                    return (
                                        <button key={index} className={btnClass} onClick={() => handleAnswerSelect(index)} disabled={selectedAnswer !== null}>
                                            {option}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </>
                )}
                {quizState === 'finished' && (
                    <div className="quiz-results">
                        <Icon name="check" className="w-16 h-16 text-green-500"/>
                        <h3 className="text-2xl font-bold mt-4">Quiz Complete!</h3>
                        <p className="text-secondary mt-2">You scored</p>
                        <p className="text-5xl font-bold my-2">{score} <span className="text-2xl text-secondary">/ {questions.length}</span></p>
                    </div>
                )}
            </div>
            <div className="modal-footer">
                {quizState === 'active' && selectedAnswer !== null && (
                    <button className="btn btn-primary" onClick={handleNextQuestion}>
                        {currentQuestionIndex < questions.length - 1 ? 'Next Question' : 'Finish Quiz'}
                    </button>
                )}
                {quizState === 'finished' && (
                    <>
                        <button className="btn btn-secondary" onClick={handleRetake}>Retake Quiz</button>
                        <button className="btn btn-primary" onClick={onClose}>Close</button>
                    </>
                )}
            </div>
        </Modal>
    );
};


const ResourcesView = ({ resources, setResources, currentUser, addNotification }: { resources: Resource[], setResources: React.Dispatch<React.SetStateAction<Resource[]>>, currentUser: User, addNotification: (message: string, type: AppNotification['type']) => void }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingResource, setEditingResource] = useState<Resource | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [filters, setFilters] = useState({ department: 'all', type: 'all' });
    type SortableKeys = 'name' | 'department' | 'subject' | 'uploaderName' | 'timestamp';
    const [sortConfig, setSortConfig] = useState<{ key: SortableKeys; direction: 'ascending' | 'descending' }>({ key: 'timestamp', direction: 'descending' });

    const [isQuizModalOpen, setIsQuizModalOpen] = useState(false);
    const [selectedResourceForQuiz, setSelectedResourceForQuiz] = useState<Resource | null>(null);


    const canUpload = ['faculty', 'hod', 'principal', 'admin', 'creator'].includes(currentUser.role);

    const canManageResource = (resource: Resource) => {
        if (['admin', 'principal', 'creator'].includes(currentUser.role)) {
            return true;
        }
        if (currentUser.role === 'hod' && currentUser.dept === resource.department) {
            return true;
        }
        if (currentUser.id === resource.uploaderId) {
            return true;
        }
        return false;
    };

    const requestSort = (key: SortableKeys) => {
        let direction: 'ascending' | 'descending' = 'ascending';
        if (sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    const filteredResources = useMemo(() => {
        let sortableResources = [...resources];
        sortableResources.sort((a, b) => {
            const aValue = a[sortConfig.key];
            const bValue = b[sortConfig.key];

            if (aValue < bValue) {
                return sortConfig.direction === 'ascending' ? -1 : 1;
            }
            if (aValue > bValue) {
                return sortConfig.direction === 'ascending' ? 1 : -1;
            }
            return 0;
        });

        return sortableResources
            .filter(res => {
                const searchMatch = searchTerm === '' || 
                                  res.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                                  res.subject.toLowerCase().includes(searchTerm.toLowerCase());
                const deptMatch = filters.department === 'all' || res.department === filters.department;
                const typeMatch = filters.type === 'all' || res.type === filters.type;
                return searchMatch && deptMatch && typeMatch;
            });
    }, [resources, searchTerm, filters, sortConfig]);

    const handleUploadClick = () => {
        setEditingResource({
            id: `new_${Date.now()}`,
            name: '',
            type: 'notes',
            department: currentUser.dept,
            subject: '',
            uploaderId: currentUser.id,
            uploaderName: currentUser.name,
            timestamp: Date.now(),
        });
        setIsModalOpen(true);
    };
    
    const handleEdit = (resource: Resource) => {
        setEditingResource(resource);
        setIsModalOpen(true);
    };

    const handleDelete = (resourceId: string) => {
        if (window.confirm('Are you sure you want to delete this resource?')) {
            setResources(prev => prev.filter(res => res.id !== resourceId));
            addNotification('Resource deleted successfully.', 'info');
        }
    };
    
    const handleSave = (resource: Resource) => {
        if (resource.id.startsWith('new_')) {
            setResources(prev => [{ ...resource, id: `res_${Date.now()}` }, ...prev]);
            addNotification('Resource uploaded successfully!', 'success');
        } else {
            setResources(prev => prev.map(res => res.id === resource.id ? resource : res));
            addNotification('Resource updated successfully!', 'success');
        }
        setIsModalOpen(false);
        setEditingResource(null);
    };

    const handleDownload = (resource: Resource) => {
        addNotification(`Preparing download for "${resource.name}"...`, 'info');
        try {
            const filename = resource.name.replace(/[^a-z0-9_.-]/gi, '_').toLowerCase();
            const fileContent = JSON.stringify(resource, null, 2);
            const blob = new Blob([fileContent], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `${filename}.json`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error("Download failed:", error);
            addNotification("Failed to prepare download.", "error");
        }
    };

    const handleGenerateQuiz = (resource: Resource) => {
        setSelectedResourceForQuiz(resource);
        setIsQuizModalOpen(true);
    };

    const resourceTypeStyles: { [key in Resource['type']]: { icon: string; className: string; } } = {
        book: { icon: 'book', className: 'resource-icon-bg-book' },
        notes: { icon: 'notes', className: 'resource-icon-bg-notes' },
        project: { icon: 'project', className: 'resource-icon-bg-project' },
        lab: { icon: 'lab', className: 'resource-icon-bg-lab' },
        other: { icon: 'other', className: 'resource-icon-bg-other' },
    };

    const getSortableHeader = (key: SortableKeys, title: string) => {
        const isActive = sortConfig.key === key;
        const icon = isActive
            ? <Icon name={sortConfig.direction === 'ascending' ? 'chevron-up' : 'chevron-down'} className="w-4 h-4 text-accent" />
            : <Icon name="chevron-up-down" className="w-4 h-4 text-secondary opacity-50" />;

        return (
            <th onClick={() => requestSort(key)} className="sortable-header">
                <div className="flex items-center gap-1">
                    {title}
                    {icon}
                </div>
            </th>
        );
    };


    return (
        <>
            <div className="view-header">
                <h2 className="text-2xl font-bold">Resources</h2>
                {canUpload && (
                    <button className="btn btn-primary" onClick={handleUploadClick}>
                        <Icon name="upload" className="w-4 h-4" /> Upload Resource
                    </button>
                )}
            </div>

            <div className="dashboard-card mb-6">
                 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                     <div className="control-group !mb-0 col-span-1 md:col-span-1">
                        <label htmlFor="search-res">Search Name/Subject</label>
                        <input id="search-res" type="text" className="form-control" placeholder="e.g., Data Structures" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                    </div>
                     <div className="control-group !mb-0">
                        <label htmlFor="filter-res-dept">Filter by Department</label>
                        <select id="filter-res-dept" className="form-control" value={filters.department} onChange={e => setFilters(f => ({...f, department: e.target.value}))}>
                            <option value="all">All Departments</option>
                            {DEPARTMENTS.map(dept => <option key={dept} value={dept}>{dept}</option>)}
                        </select>
                    </div>
                     <div className="control-group !mb-0">
                        <label htmlFor="filter-res-type">Filter by Type</label>
                        <select id="filter-res-type" className="form-control" value={filters.type} onChange={e => setFilters(f => ({...f, type: e.target.value}))}>
                            <option value="all">All Types</option>
                            <option value="book">Book</option>
                            <option value="notes">Notes</option>
                            <option value="project">Project</option>
                            <option value="lab">Lab Manual</option>
                            <option value="other">Other</option>
                        </select>
                    </div>
                 </div>
            </div>

            <div className="table-wrapper">
                <table className="entry-list-table">
                    <thead>
                        <tr>
                            {getSortableHeader('name', 'Name')}
                            {getSortableHeader('department', 'Department')}
                            {getSortableHeader('subject', 'Subject')}
                            {getSortableHeader('uploaderName', 'Uploader')}
                            {getSortableHeader('timestamp', 'Date')}
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                         {filteredResources.length > 0 ? filteredResources.map(res => {
                            const typeStyle = resourceTypeStyles[res.type];
                            return (
                                <tr key={res.id}>
                                    <td>
                                        <div className="flex items-center gap-3">
                                            <div className={`resource-icon-container ${typeStyle.className}`}>
                                                <Icon name={typeStyle.icon} className="w-5 h-5"/>
                                            </div>
                                            <div>
                                                <div className="font-bold">{res.name}</div>
                                                <div className="text-sm text-secondary capitalize">{res.type}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td>{res.department}</td>
                                    <td>{res.subject}</td>
                                    <td>{res.uploaderName}</td>
                                    <td>{new Date(res.timestamp).toLocaleDateString()}</td>
                                    <td>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            {['book', 'notes'].includes(res.type) && (
                                                <button className="btn btn-secondary btn-sm" onClick={() => handleGenerateQuiz(res)} title="Generate Quiz">
                                                    <Icon name="lightbulb" className="w-4 h-4"/>
                                                </button>
                                            )}
                                            <button className="btn btn-secondary btn-sm" onClick={() => handleDownload(res)} title="Download">
                                                <Icon name="download" className="w-4 h-4"/>
                                            </button>
                                            {canManageResource(res) && (
                                                <>
                                                    <button className="btn btn-secondary btn-sm" onClick={() => handleEdit(res)} title="Edit">
                                                        <Icon name="edit" className="w-4 h-4"/>
                                                    </button>
                                                     <button className="btn btn-danger-outline btn-sm" onClick={() => handleDelete(res.id)} title="Delete">
                                                        <Icon name="trash" className="w-4 h-4"/>
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            )
                         }) : (
                            <tr>
                                <td colSpan={6} className="text-center py-8 text-secondary">
                                    No resources found.
                                </td>
                            </tr>
                         )}
                    </tbody>
                </table>
            </div>
            
            {isModalOpen && editingResource && <ResourceModal resource={editingResource} onSave={handleSave} onClose={() => setIsModalOpen(false)} addNotification={addNotification} />}
            {isQuizModalOpen && selectedResourceForQuiz && <QuizModal resource={selectedResourceForQuiz} onClose={() => setIsQuizModalOpen(false)} addNotification={addNotification} />}
        </>
    );
};


// --- MAIN APP COMPONENT ---
const App = () => {
    // --- State Management ---
    const [users, setUsers] = useLocalStorage<User[]>('app_users', initialUsers);
    const [timetable, setTimetable] = useLocalStorage<TimetableEntry[]>('app_timetable', initialTimetable);
    const [announcements, setAnnouncements] = useLocalStorage<Announcement[]>('app_announcements', initialAnnouncements);
    const [resources, setResources] = useLocalStorage<Resource[]>('app_resources', initialResources);
    const [courseFiles, setCourseFiles] = useLocalStorage<CourseFile[]>('app_course_files', initialCourseFiles);
    const [calendarEvents, setCalendarEvents] = useLocalStorage<CalendarEvent[]>('app_calendar_events', initialCalendarEvents);
    const [securityAlerts, setSecurityAlerts] = useLocalStorage<SecurityAlert[]>('app_security_alerts', initialSecurityAlerts);
    const [settings, setSettings] = useLocalStorage<AppSettings>('app_settings', initialAppSettings);
    
    const [currentUser, setCurrentUser] = useLocalStorage<User | null>('app_current_user', null);
    const [currentView, setCurrentView] = useLocalStorage<AppView>('app_current_view', 'auth');
    const [chatMessages, setChatMessages] = useLocalStorage<ChatMessage[]>('app_chat_messages', []);

    const [isSidebarOpen, setSidebarOpen] = useState(false);
    const [isCommandBarOpen, setCommandBarOpen] = useState(false);
    const [isChatOpen, setChatOpen] = useState(false);
    const [isNotificationCenterOpen, setNotificationCenterOpen] = useState(false);
    const chatRef = useRef<Chat | null>(null);

    const { notifications, toastQueue, addNotification, markAllAsRead, clearNotifications, unreadCount } = useAppNotifications();

    // --- Effects ---
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', settings.theme);
        const activeTheme = THEMES.find(t => t.name === settings.activeTheme) || THEMES[0];
        for (const [key, value] of Object.entries(activeTheme.colors)) {
            document.documentElement.style.setProperty(key, value);
        }
    }, [settings.theme, settings.activeTheme]);
    
    useEffect(() => {
        if (!currentUser) {
            setCurrentView('auth');
        }
    }, [currentUser]);

    // --- Data Handlers ---
    const addUser = (user: User) => setUsers(prev => [...prev, user]);

    // --- Render Logic ---
    const getHeaderTitle = (view: AppView): string => {
        const titles: Record<AppView, string> = {
            dashboard: 'Dashboard',
            timetable: 'Timetable',
            manage: 'Manage',
            settings: 'Settings',
            auth: 'Authentication',
            approvals: 'User Approvals',
            announcements: 'Announcements',
            studentDirectory: 'Student Directory',
            security: 'Security Center',
            userManagement: 'User Management',
            resources: 'Resources',
            academicCalendar: 'Academic Calendar',
            courseFiles: 'Course Files',
        };
        return titles[view] || 'Academic Assistant';
    };

    const handleLogout = () => {
        setCurrentUser(null);
        setCurrentView('auth');
        addNotification("You have been logged out.", 'info');
    };
    
    const handleClearChat = () => {
        setChatMessages([]);
        chatRef.current = null; // Reset chat context
        addNotification("Chat history cleared.", "info");
    };

    const handleSendMessage = async (message: string) => {
        if (!ai) return;

        const userMessage: ChatMessage = { id: `msg_${Date.now()}`, role: 'user', text: message };
        setChatMessages(prev => [...prev, userMessage]);

        try {
            if (!chatRef.current) {
                const systemInstruction = `You are a helpful academic assistant for a college portal. Be friendly and concise. The user is currently on the "${currentView}" page. Prioritize answers related to this page if applicable.`;
                chatRef.current = ai.chats.create({
                    model: 'gemini-2.5-flash',
                    config: { systemInstruction }
                });
            }

            const loadingId = `loading_${Date.now()}`;
            setChatMessages(prev => [...prev, { id: loadingId, role: 'model', text: '...' }]);
            
            const stream = await chatRef.current.sendMessageStream({ message });
            
            let modelMessage: ChatMessage = { id: `msg_${Date.now()}`, role: 'model', text: '' };
            setChatMessages(prev => [...prev.filter(m => m.id !== loadingId), modelMessage]);

            for await (const chunk of stream) {
                modelMessage.text += chunk.text;
                setChatMessages(prev => prev.map(m => m.id === modelMessage.id ? { ...m, text: modelMessage.text } : m));
            }

        } catch (error) {
            console.error("Chat error:", error);
            const errorMessage: ChatMessage = { id: `err_${Date.now()}`, role: 'model', text: "Sorry, I couldn't get a response. Please try again.", isError: true };
            setChatMessages(prev => [...prev.filter(m => m.role !== 'model' || m.text !== '...'), errorMessage]);
        }
    };

    if (!currentUser || currentView === 'auth') {
        return <AuthView setView={setCurrentView} setCurrentUser={setCurrentUser} users={users} addUser={addUser} addNotification={addNotification} />;
    }

    const navItems = [
        { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', roles: ROLES },
        { id: 'timetable', label: 'Timetable', icon: 'timetable', roles: ROLES },
        { id: 'announcements', label: 'Announcements', icon: 'announcements', roles: ROLES },
        { id: 'academicCalendar', label: 'Calendar', icon: 'academicCalendar', roles: ROLES },
        { id: 'resources', label: 'Resources', icon: 'resources', roles: ROLES },
        { id: 'courseFiles', label: 'Course Files', icon: 'courseFiles', roles: ['faculty', 'hod', 'principal', 'admin'] },
        { id: 'approvals', label: 'Approvals', icon: 'approvals', roles: ['admin', 'hod', 'principal'] },
        { id: 'userManagement', label: 'User Management', icon: 'userManagement', roles: ['admin'] },
        { id: 'security', label: 'Security', icon: 'security', roles: ['admin'] },
        { id: 'settings', label: 'Settings', icon: 'settings', roles: ROLES },
    ];

    return (
        <div className={`app-container ${isSidebarOpen ? 'sidebar-open' : ''}`}>
            <div className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
                <div className="sidebar-header">
                    <a href="#" className="logo"><Icon name="dashboard" /></a>
                    <h1>AcademiaAI</h1>
                    <button className="sidebar-close" onClick={() => setSidebarOpen(false)}><Icon name="close" /></button>
                </div>
                <nav className="nav-list">
                    <ul>
                       {navItems.filter(item => item.roles.includes(currentUser.role)).map(item => (
                             <li className="nav-item" key={item.id}>
                                <button
                                    className={currentView === item.id ? 'active' : ''}
                                    onClick={() => {
                                        setCurrentView(item.id as AppView);
                                        setSidebarOpen(false);
                                    }}
                                >
                                    <Icon name={item.icon} />
                                    <span>{item.label}</span>
                                </button>
                            </li>
                       ))}
                    </ul>
                </nav>
                <div className="sidebar-footer">
                    <div className="flex items-center gap-3 p-2">
                        <div className="w-10 h-10 bg-tertiary rounded-full flex items-center justify-center font-bold text-accent-primary">
                            {currentUser.name.charAt(0)}
                        </div>
                        <div>
                            <p className="font-semibold text-sm">{currentUser.name}</p>
                            <p className="text-xs text-secondary capitalize">{currentUser.role}</p>
                        </div>
                         <button onClick={handleLogout} className="logout-btn ml-auto" aria-label="Logout"><Icon name="logout" /></button>
                    </div>
                </div>
            </div>
             <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)}></div>
            <main className="main-content">
                <header className="header">
                    <div className="header-left">
                        <button className="menu-toggle" onClick={() => setSidebarOpen(true)}><Icon name="menu" /></button>
                        <h2 className="header-title">{getHeaderTitle(currentView)}</h2>
                    </div>
                    <div className="header-right">
                         <button className="header-action-btn" aria-label="Search (Ctrl+K)" onClick={() => setCommandBarOpen(true)}><Icon name="search"/></button>
                         <button className="header-action-btn" aria-label="Notifications" onClick={() => { setNotificationCenterOpen(v => !v); if (unreadCount > 0) markAllAsRead(); }}>
                             <Icon name="bell"/>
                             {unreadCount > 0 && <span className="notification-badge">{unreadCount}</span>}
                         </button>
                         {isNotificationCenterOpen && <NotificationCenter notifications={notifications} onClear={clearNotifications} onClose={() => setNotificationCenterOpen(false)}/>}
                    </div>
                </header>
                <div className="page-content">
                    {currentView === 'dashboard' && <DashboardView currentUser={currentUser} announcements={announcements} calendarEvents={calendarEvents} users={users} securityAlerts={securityAlerts} setView={setCurrentView} setUsers={setUsers} addNotification={addNotification} />}
                    {currentView === 'timetable' && <TimetableView currentUser={currentUser} timetable={timetable} settings={settings} setTimetable={setTimetable} addNotification={addNotification} />}
                    {currentView === 'announcements' && <AnnouncementsView announcements={announcements} setAnnouncements={setAnnouncements} currentUser={currentUser} addNotification={addNotification}/>}
                    {currentView === 'academicCalendar' && <AcademicCalendarView events={calendarEvents} setEvents={setCalendarEvents} currentUser={currentUser} addNotification={addNotification} />}
                    {currentView === 'userManagement' && <UserManagementView users={users} setUsers={setUsers} addNotification={addNotification} />}
                    {currentView === 'security' && <SecurityView securityAlerts={securityAlerts} setSecurityAlerts={setSecurityAlerts} users={users} setUsers={setUsers} addNotification={addNotification} />}
                    {currentView === 'settings' && <SettingsView settings={settings} setSettings={setSettings} currentUser={currentUser} addNotification={addNotification} />}
                    {currentView === 'courseFiles' && <CourseFilesView courseFiles={courseFiles} setCourseFiles={setCourseFiles} currentUser={currentUser} addNotification={addNotification} />}
                    {currentView === 'resources' && <ResourcesView resources={resources} setResources={setResources} currentUser={currentUser} addNotification={addNotification} />}
                    {![ 'dashboard', 'timetable', 'academicCalendar', 'settings', 'announcements', 'userManagement', 'courseFiles', 'security', 'resources'].includes(currentView) && (
                        <div className="flex flex-col items-center justify-center h-full text-center">
                            <Icon name={currentView} className="w-16 h-16 text-secondary mb-4" />
                            <h2 className="text-2xl font-semibold">{getHeaderTitle(currentView)}</h2>
                            <p className="text-secondary mt-2">This feature is under construction. Check back soon!</p>
                        </div>
                    )}
                </div>
            </main>
             <div className="notification-container">
                {toastQueue.map(n => (
                    <NotificationToast key={n.id} notification={n} onRemove={() => {}} />
                ))}
            </div>
            {isCommandBarOpen && <CommandBar onClose={() => setCommandBarOpen(false)} navItems={navItems.filter(i => i.roles.includes(currentUser.role))} users={users} setView={setCurrentView} currentUser={currentUser} />}
            <Chatbot isOpen={isChatOpen} onToggle={() => setChatOpen(prev => !prev)} messages={chatMessages} onSendMessage={handleSendMessage} onClearChat={handleClearChat} currentView={currentView} />
        </div>
    );
};

const CommandBar = ({ onClose, navItems, users, setView, currentUser }: { onClose: () => void, navItems: any[], users: User[], setView: (v: AppView) => void, currentUser: User }) => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                onClose(); // This seems wrong, should open if closed. The button handles opening.
            }
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);
    
    useEffect(() => {
        const timer = setTimeout(() => {
            if (query.trim() === '') {
                setResults([]);
                return;
            }
            performSearch(query);
        }, 200);
        return () => clearTimeout(timer);
    }, [query]);

    const performSearch = async (currentQuery: string) => {
        const lowerQuery = currentQuery.toLowerCase();
        
        const navResults = navItems
            .filter(item => item.label.toLowerCase().includes(lowerQuery))
            .map(item => ({ type: 'nav', ...item }));

        const userResults = users
            .filter(user => user.name.toLowerCase().includes(lowerQuery))
            .map(user => ({ type: 'user', ...user }));
            
        const allResults = [...navResults, ...userResults];
        
        if (allResults.length === 0 && isAiEnabled) {
            allResults.push({ type: 'ai', query: currentQuery });
        }
        
        setResults(allResults);
    };
    
    const handleAiQuery = async (aiQuery: string) => {
        if (!ai) return;
        setIsLoading(true);
        try {
            const context = `You are an AI assistant for a college portal. Current user is ${currentUser.name} (${currentUser.role}). Available users: ${users.map(u => `${u.name} (${u.role})`).join(', ')}.`;
            const prompt = `${context}\n\nAnswer the following question based on the provided context or general knowledge if the context is insufficient.\n\nQuestion: "${aiQuery}"`;
            
            const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
            setResults([{ type: 'ai_response', text: response.text }]);
        } catch (error) {
            console.error("Command bar AI error:", error);
            setResults([{ type: 'ai_response', text: 'Sorry, I had trouble answering that.' }]);
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleSelect = (item: any) => {
        if (item.type === 'nav') {
            setView(item.id);
            onClose();
        } else if (item.type === 'user') {
            // Future: show user profile
            console.log("Selected user:", item);
            onClose();
        } else if (item.type === 'ai') {
            handleAiQuery(item.query);
        }
    };

    return createPortal(
        <div className="command-bar-overlay" onMouseDown={onClose}>
            <div className="command-bar-content" onMouseDown={e => e.stopPropagation()}>
                <div className="command-bar-input-wrapper">
                    <Icon name="search" />
                    <input
                        type="text"
                        placeholder="Search or ask AI..."
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        autoFocus
                    />
                     {isLoading && <div className="spinner"></div>}
                </div>
                <div className="command-bar-results">
                    {results.length > 0 ? (
                        <ul>
                            {results.map((item, index) => (
                                <li key={index} onClick={() => handleSelect(item)} className="result-item">
                                    {item.type === 'nav' && <><Icon name={item.icon} /> <span>{item.label}</span></>}
                                    {item.type === 'user' && <><Icon name="user" /> <span>{item.name} <em className="text-secondary">- {item.role}</em></span></>}
                                    {item.type === 'ai' && <><Icon name="sparkles" /> <span>Ask AI: "{item.query}"</span></>}
                                    {item.type === 'ai_response' && <div className="p-2" dangerouslySetInnerHTML={{ __html: marked(item.text) }}></div>}
                                </li>
                            ))}
                        </ul>
                    ) : query && (
                        <div className="results-empty">No results found for "{query}"</div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

const NotificationCenter = ({ notifications, onClear, onClose }: { notifications: HistoricalNotification[], onClear: () => void, onClose: () => void }) => {
    const popoverRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [onClose]);

    return (
        <div className="notification-center-popover" ref={popoverRef}>
            <div className="notification-center-header">
                <h3>Notifications</h3>
                <button onClick={onClear} className="btn-link text-xs">Clear All</button>
            </div>
            <div className="notification-center-list">
                {notifications.length > 0 ? notifications.map(n => (
                    <div key={n.id} className="notification-item">
                         <div className={`toast-icon text-${n.type}`}><Icon name={n.type} /></div>
                         <div className="notification-item-content">
                             <p>{n.message}</p>
                             <small>{formatRelativeTime(n.timestamp)}</small>
                         </div>
                    </div>
                )) : (
                    <div className="notification-empty">
                        <Icon name="bell" className="w-12 h-12 text-secondary" />
                        <p>No new notifications</p>
                    </div>
                )}
            </div>
        </div>
    );
};


const Chatbot = ({ isOpen, onToggle, messages, onSendMessage, onClearChat, currentView }: { isOpen: boolean, onToggle: () => void, messages: ChatMessage[], onSendMessage: (msg: string) => void, onClearChat: () => void, currentView: AppView }) => {
    const [input, setInput] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (input.trim()) {
            onSendMessage(input);
            setInput('');
        }
    };
    
    // Fix: Separated 'default' suggestions and made the main suggestions object a Partial Record.
    const promptSuggestions: Partial<Record<AppView, string[]>> = {
        dashboard: ["Summarize my day.", "Any important deadlines?", "What are the latest announcements?"],
        timetable: ["What's my next class?", "Show me Friday's schedule.", "Who teaches Algorithms?"],
        announcements: ["What's the latest important news?", "Summarize the guest lecture announcement."],
        academicCalendar: ["When do mid-term exams start?", "Are there any holidays this month?"],
        userManagement: ["How many students are pending approval?", "Show me all HODs."],
    };

    const defaultSuggestions = ["What can you do?", "Explain the dashboard.", "How do I change my theme?"];

    const suggestions = promptSuggestions[currentView] || defaultSuggestions;

    return (
        <div className="chatbot-container">
            {isOpen && (
                <div className="chatbot-window">
                    <div className="chatbot-header">
                        <span>AI Assistant</span>
                        <div>
                            <button onClick={onClearChat} className="btn-link text-xs mr-2">New Chat</button>
                            <button onClick={onToggle}><Icon name="close" className="w-5 h-5"/></button>
                        </div>
                    </div>
                    <div className="chatbot-messages">
                       {messages.length === 0 && (
                            <div className="chat-prompts">
                                {suggestions.map((prompt, i) => (
                                    <button key={i} onClick={() => onSendMessage(prompt)}>{prompt}</button>
                                ))}
                            </div>
                       )}
                       {messages.map((msg, index) => (
                           <div key={index} className={`chat-bubble ${msg.role} ${msg.isError ? 'error' : ''}`}>
                               {msg.text === '...' ? <div className="spinner"/> : <div dangerouslySetInnerHTML={{ __html: marked(msg.text) }} />}
                           </div>
                       ))}
                       <div ref={messagesEndRef} />
                    </div>
                    <form className="chatbot-input-form" onSubmit={handleSubmit}>
                        <input type="text" placeholder="Ask anything..." value={input} onChange={e => setInput(e.target.value)} disabled={!isAiEnabled}/>
                        <button type="submit" disabled={!input.trim() || !isAiEnabled}><Icon name="send" /></button>
                    </form>
                </div>
            )}
            <button className="chatbot-toggle" onClick={onToggle} aria-label="Toggle AI Chat">
                <Icon name={isOpen ? "close" : "sparkles"} />
            </button>
        </div>
    );
};

const StudyPlanModal = ({ onSave, onClose, addNotification }: { onSave: (plan: StudyPlan) => void; onClose: () => void; addNotification: (m: string, t: AppNotification['type']) => void; }) => {
    const [subject, setSubject] = useState('');
    const [duration, setDuration] = useState(4); // weeks
    const [isLoading, setIsLoading] = useState(false);
    const [generatedPlan, setGeneratedPlan] = useState<StudyPlan | null>(null);

    const handleGenerate = async () => {
        if (!ai || !subject) {
            addNotification("Please enter a subject.", "warning");
            return;
        }
        setIsLoading(true);
        try {
            const prompt = `Create a detailed ${duration}-week study plan for the subject "${subject}". Break it down by week, and for each week, provide a daily plan (Monday to Saturday) with a main topic and 2-3 specific, actionable tasks.`;
            const planSchema = {
                type: Type.OBJECT,
                properties: {
                    title: { type: Type.STRING },
                    weeks: { type: Type.ARRAY, items: {
                        type: Type.OBJECT, properties: {
                            week: { type: Type.INTEGER },
                            days: { type: Type.ARRAY, items: {
                                type: Type.OBJECT, properties: {
                                    day: { type: Type.STRING },
                                    topic: { type: Type.STRING },
                                    tasks: { type: Type.ARRAY, items: {
                                        type: Type.OBJECT, properties: {
                                            text: { type: Type.STRING },
                                            completed: { type: Type.BOOLEAN },
                                        }
                                    }}
                                }
                            }}
                        }
                    }}
                }
            };
            const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt, config: { responseMimeType: 'application/json', responseSchema: planSchema } });
            const planData = JSON.parse(response.text);
            setGeneratedPlan({ id: `plan_${Date.now()}`, ...planData });

        } catch (error) {
            console.error("Study plan generation failed:", error);
            addNotification("Failed to generate study plan.", "error");
        } finally {
            setIsLoading(false);
        }
    };

    const handleTaskToggle = (weekIndex: number, dayIndex: number, taskIndex: number) => {
        if (!generatedPlan) return;
        const newPlan = { ...generatedPlan };
        newPlan.weeks[weekIndex].days[dayIndex].tasks[taskIndex].completed = !newPlan.weeks[weekIndex].days[dayIndex].tasks[taskIndex].completed;
        setGeneratedPlan(newPlan);
    };

    return (
        <Modal onClose={onClose} size="large">
             <div className="modal-header">
                <h3><Icon name="study-plan" className="w-6 h-6"/> AI Study Plan Generator</h3>
                <button onClick={onClose} className="modal-close-btn"><Icon name="close" /></button>
            </div>
            <div className="modal-body">
                {!generatedPlan ? (
                    <>
                        <div className="control-group">
                            <label htmlFor="subject-plan">Subject</label>
                            <input type="text" id="subject-plan" className="form-control" value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g., Data Structures and Algorithms" />
                        </div>
                         <div className="control-group">
                            <label htmlFor="duration-plan">Duration (in weeks)</label>
                            <input type="number" id="duration-plan" className="form-control" value={duration} onChange={e => setDuration(parseInt(e.target.value, 10))} min="1" max="12" />
                        </div>
                    </>
                ) : (
                    <div className="study-plan-display">
                        <h3 className="text-xl font-bold mb-4">{generatedPlan.title}</h3>
                        {generatedPlan.weeks.map((week, weekIndex) => (
                            <details key={week.week} className="study-plan-week" open>
                                <summary>Week {week.week}</summary>
                                <div className="study-plan-days">
                                    {week.days.map((day, dayIndex) => (
                                        <div key={day.day} className="study-plan-day">
                                            <h4>{day.day} - <span className="font-normal text-secondary">{day.topic}</span></h4>
                                            <ul>
                                                {day.tasks.map((task, taskIndex) => (
                                                    <li key={taskIndex}>
                                                        <input type="checkbox" id={`task-${weekIndex}-${dayIndex}-${taskIndex}`} checked={task.completed} onChange={() => handleTaskToggle(weekIndex, dayIndex, taskIndex)} />
                                                        <label htmlFor={`task-${weekIndex}-${dayIndex}-${taskIndex}`}>{task.text}</label>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    ))}
                                </div>
                            </details>
                        ))}
                    </div>
                )}
            </div>
            <div className="modal-footer">
                {!generatedPlan ? (
                     <button className="btn btn-primary" onClick={handleGenerate} disabled={isLoading}>
                        {isLoading ? <><span className="spinner"></span> Generating...</> : 'Generate Plan'}
                    </button>
                ) : (
                    <>
                        <button className="btn btn-secondary" onClick={() => setGeneratedPlan(null)}>Start Over</button>
                        <button className="btn btn-primary" onClick={() => onSave(generatedPlan)}>Save Plan</button>
                    </>
                )}
            </div>
        </Modal>
    );
};

const AITimetableAssistant = ({ onClose, settings, addNotification, timetable, setTimetable, filter }: { onClose: () => void; settings: AppSettings; addNotification: (m: string, t: AppNotification['type']) => void; timetable: TimetableEntry[]; setTimetable: React.Dispatch<React.SetStateAction<TimetableEntry[]>>; filter: { department: string; year: string | undefined } }) => {
    const [query, setQuery] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState('Thinking...');
    const [suggestion, setSuggestion] = useState<TimetableEntry[] | null>(null);
    // FIX: A conflicting entry is a *proposed* entry from AI and does not have an ID yet.
    // The type is updated to Omit the 'id' property to match the actual data shape, resolving the type error.
    const [conflicts, setConflicts] = useState<{ conflictingEntry: Omit<TimetableEntry, 'id'>; existingEntry: TimetableEntry; }[] | null>(null);
    const [resolution, setResolution] = useState<TimetableEntry[] | null>(null);

    const schema = {
        type: Type.OBJECT,
        properties: {
            entries: { type: Type.ARRAY, items: {
                type: Type.OBJECT,
                properties: {
                    day: { type: Type.STRING },
                    timeIndex: { type: Type.INTEGER },
                    subject: { type: Type.STRING },
                    type: { type: Type.STRING, enum: ['class', 'lab', 'break', 'common'] },
                    faculty: { type: Type.STRING },
                    room: { type: Type.STRING }
                }
            }}
        }
    };
    
    // FIX: The signature of `handleResolveConflict` is updated to accept the correct type for `detectedConflicts`, which includes the `conflictingEntry` property.
    const handleResolveConflict = async (originalQuery: string, detectedConflicts: { conflictingEntry: Omit<TimetableEntry, 'id'>; existingEntry: TimetableEntry; }[]) => {
        if (!ai) return;
        setLoadingMessage('Conflict found, resolving...');
        try {
            const conflictDetails = detectedConflicts.map(c => 
                `The slot on ${c.existingEntry.day} at ${settings.timeSlots[c.existingEntry.timeIndex]} is already taken by '${c.existingEntry.subject}'.`
            ).join(' ');
            
            const resolvePrompt = `You are a timetable scheduling assistant. The user's original request was: "${originalQuery}".
            Your first attempt to schedule this resulted in the following conflicts: ${conflictDetails}
            Please find an alternative schedule that fulfills the original request but avoids these specific conflicts. Suggest alternative time slots, days or rooms.
            Provide a new, conflict-free array of one or more timetable entry objects.
            Department: ${filter.department}, Year: ${filter.year}.
            Available Time Slots: ${JSON.stringify(settings.timeSlots)}.
            Existing schedule for this class: ${JSON.stringify(timetable.filter(e => e.department === filter.department && e.year === filter.year))}.`;
            
            const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: resolvePrompt, config: { responseMimeType: 'application/json', responseSchema: schema } });
            const { entries: resolvedEntries } = JSON.parse(response.text);

            const resolvedEntriesWithDeptAndYear = resolvedEntries.map((e: Omit<TimetableEntry, 'id'|'department'|'year'>) => ({...e, department: filter.department, year: filter.year}));
            
            setResolution(resolvedEntriesWithDeptAndYear);
            addNotification("Found a conflict-free alternative!", "success");

        } catch (error) {
            console.error("AI conflict resolution failed:", error);
            addNotification("Sorry, I couldn't automatically resolve the conflict.", "error");
        } finally {
            setIsLoading(false);
        }
    };

    const handleGenerate = async () => {
        if (!ai || !query) {
            addNotification("Please enter a command.", "warning");
            return;
        }
        setIsLoading(true);
        setLoadingMessage('Thinking...');
        setSuggestion(null);
        setConflicts(null);
        setResolution(null);

        try {
            const existingSchedule = timetable.filter(e => e.department === filter.department && e.year === filter.year);
            const prompt = `You are a timetable scheduling assistant. Based on the user command, schedule a class.
            User Command: "${query}"
            Department: ${filter.department}, Year: ${filter.year}.
            Available Time Slots: ${JSON.stringify(settings.timeSlots)}.
            Existing schedule for this class (don't overwrite these): ${JSON.stringify(existingSchedule)}.
            Parse the user's command and find available slots. Return an array of one or more timetable entry objects to be added. If it is a lab, it usually takes 2 consecutive hours.`;
            
            const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt, config: { responseMimeType: 'application/json', responseSchema: schema } });
            const { entries: initialEntries } = JSON.parse(response.text);
            
            const detectedConflicts: { conflictingEntry: Omit<TimetableEntry, 'id'>; existingEntry: TimetableEntry; }[] = [];
            initialEntries.forEach((newEntry: Omit<TimetableEntry, 'id' | 'department' | 'year'>) => {
                const existing = existingSchedule.find(e => e.day === newEntry.day && e.timeIndex === newEntry.timeIndex);
                if (existing) {
                    const newEntryWithMeta = {...newEntry, department: filter.department!, year: filter.year! };
                    detectedConflicts.push({ conflictingEntry: newEntryWithMeta, existingEntry: existing });
                }
            });
            
            const entriesWithDeptAndYear = initialEntries.map((e: Omit<TimetableEntry, 'id' | 'department' | 'year'>) => ({...e, department: filter.department, year: filter.year}));

            if (detectedConflicts.length > 0) {
                setSuggestion(entriesWithDeptAndYear);
                setConflicts(detectedConflicts);
                await handleResolveConflict(query, detectedConflicts);
            } else {
                setSuggestion(entriesWithDeptAndYear);
                setIsLoading(false);
            }

        } catch (error) {
            console.error("AI timetable assistance failed:", error);
            addNotification("Sorry, I couldn't understand that request.", "error");
            setIsLoading(false);
        }
    };
    
    const handleApply = () => {
        const entriesToApply = resolution || suggestion;
        if (!entriesToApply) return;

        const newEntries = entriesToApply.map(e => ({ ...e, id: `tt_${Date.now()}_${Math.random()}`}));
        setTimetable(prev => [...prev, ...newEntries]);
        addNotification("Timetable updated successfully!", "success");
        onClose();
    };
    
    const handleClear = () => {
        setSuggestion(null);
        setConflicts(null);
        setResolution(null);
    };

    return (
        <Modal onClose={onClose}>
            <div className="modal-header">
                <h3><Icon name="robot" className="w-6 h-6"/> AI Timetable Assistant</h3>
                <button onClick={onClose} className="modal-close-btn"><Icon name="close" /></button>
            </div>
             <div className="modal-body">
                <p className="text-secondary mb-4">Describe the class you want to schedule in plain language.</p>
                <div className="control-group">
                    <textarea className="form-control" rows={3} value={query} onChange={e => setQuery(e.target.value)} placeholder="e.g., Schedule a 2-hour lab for 'Advanced Networking' for CSE III year on Wednesday afternoon."/>
                </div>
                
                 {conflicts && (
                    <div className="conflict-details">
                        <h4><Icon name="warning" className="w-5 h-5"/> Conflicts Detected</h4>
                        {conflicts.map((c, i) => 
                            <p key={i}>
                                Slot on <strong>{c.existingEntry.day} at {settings.timeSlots[c.existingEntry.timeIndex]}</strong> is taken by <strong>'{c.existingEntry.subject}'</strong>.
                            </p>
                        )}
                    </div>
                )}

                {resolution && !isLoading && (
                    <div className="resolution-suggestion">
                        <h4><Icon name="sparkles" className="w-5 h-5"/> Resolution Suggestion</h4>
                         {resolution.map((entry, i) => (
                             <p key={i}>- Schedule <strong>{entry.subject}</strong> on {entry.day} at {settings.timeSlots[entry.timeIndex]}</p>
                        ))}
                    </div>
                )}
                
                {suggestion && !conflicts && !isLoading && (
                     <div className="ai-suggestion-panel">
                        <h4>AI Suggestion:</h4>
                         {suggestion.map((entry, i) => (
                             <p key={i}>- Add <strong>{entry.subject}</strong> on {entry.day} at {settings.timeSlots[entry.timeIndex]}</p>
                        ))}
                    </div>
                )}

             </div>
             <div className="modal-footer">
                 <div>
                    {(suggestion || resolution) && !isLoading && (
                        <button type="button" className="btn btn-secondary" onClick={handleClear}>Clear</button>
                    )}
                </div>
                <div className="flex gap-2">
                    <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
                    
                    {(!suggestion && !resolution) ? (
                        <button className="btn btn-primary" onClick={handleGenerate} disabled={isLoading}>
                            {isLoading ? <><span className="spinner"></span> {loadingMessage}</> : 'Generate Schedule'}
                        </button>
                    ) : (
                         <button className="btn btn-primary" onClick={handleApply} disabled={isLoading || (!!conflicts && !resolution)}>
                            {isLoading 
                                ? <><span className="spinner"></span> {loadingMessage}</> 
                                : (resolution ? 'Apply Resolution' : 'Apply Suggestion')
                            }
                        </button>
                    )}
                </div>
            </div>
        </Modal>
    );
};


const root = createRoot(document.getElementById('root')!);
root.render(<App />);