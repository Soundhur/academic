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
type AppView = 'dashboard' | 'timetable' | 'manage' | 'settings' | 'auth' | 'approvals' | 'announcements' | 'studentDirectory' | 'security' | 'userManagement' | 'resources' | 'academicCalendar' | 'courseFiles' | 'studentAnalytics' | 'careerCounselor';

interface CareerProfile {
    interests: string[];
    skills: string[];
    careerGoals: string;
}

interface CareerReport {
    suggestedPaths: { title: string; description: string; relevance: string; }[];
    skillsToDevelop: string[];
    recommendedCourses: { title: string; platform: string; url: string; }[];
    timestamp: number;
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
    careerProfile?: CareerProfile;
    careerReport?: CareerReport;
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
    { id: 'user_5', name: 'John Doe', role: 'student', dept: 'CSE', year: 'II', status: 'active', grades: [{ subject: 'Data Structures', score: 85 }, { subject: 'Algorithms', score: 92 }], attendance: { present: 78, total: 85 }, isLocked: false, studyPlans: [], careerProfile: { interests: ['Web Development', 'AI/ML'], skills: ['React', 'Python'], careerGoals: 'Become a full-stack developer at a tech company.' } },
    { id: 'user_6', name: 'Jane Smith', role: 'student', dept: 'CSE', year: 'II', status: 'pending_approval', isLocked: false, studyPlans: [] },
    { id: 'user_7', name: 'Creator', role: 'creator', dept: 'IT', status: 'active', isLocked: false },
    { id: 'user_8', name: 'Emily White', role: 'student', dept: 'ECE', year: 'I', status: 'active', grades: [{ subject: 'Basic Electronics', score: 55 }, { subject: 'Circuit Theory', score: 62 }], attendance: { present: 60, total: 85 }, isLocked: false, studyPlans: [] }
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
    { id: 'res_3', name: 'Algorithms Lab Manual', type: 'lab', department: 'CSE', subject: 'Algorithms', uploaderId: 'user_3', uploaderName: 'Prof. Samuel Chen', timestamp: Date.now() - 86400000 },
    { id: 'res_4', name: 'Intro to Python Notes', type: 'notes', department: 'CSE', subject: 'Python Programming', uploaderId: 'user_3', uploaderName: 'Prof. Samuel Chen', timestamp: Date.now() - 2*86400000 },

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
        settings: <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-1.007 1.11-1.11h2.596c.55.103 1.02.568 1.11 1.11l.09 1.586c.294.049.58.12.856.216l1.373-.793c.49-.283 1.096-.046 1.378.444l1.3 2.252c.282.49-.046 1.096-.444 1.378l-1.148.664c.06.27.11.543.15.82l.09 1.586c-.103.55-.568 1.02-1.11 1.11h-2.596c-.55-.103-1.02-.568-1.11-1.11l-.09-1.586a7.447 7.447 0 01-.856-.216l-1.373.793c-.49.283-1.096.046-1.378-.444l-1.3-2.252c-.282.49.046 1.096.444-1.378l1.148-.664a7.452 7.452 0 01.15-.82l.09-1.586zM12 15a3 3 0 100-6 3 3 0 000 6z" />,
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
        'book-open': <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6-2.292m0 0V11.25m6-4.75V18" />,
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
        'briefcase': <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10.5 7.5h3M10.5 3.75h3V7.5h-3V3.75z" />,
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

const StudyPlanModal = ({ onSave, onClose, addNotification }: { onSave: (plan: StudyPlan) => void, onClose: () => void, addNotification: (m: string, t: AppNotification['type']) => void }) => {
    const [topic, setTopic] = useState('');
    const [duration, setDuration] = useState(4); // weeks
    const [isLoading, setIsLoading] = useState(false);

    const handleGenerate = async () => {
        if (!ai || !topic) {
            addNotification("Please enter a topic or subject for your study plan.", "warning");
            return;
        }
        setIsLoading(true);
        try {
            const prompt = `Generate a structured ${duration}-week study plan for the topic: "${topic}". The plan should cover key concepts progressively. For each day of the week (Monday to Friday), specify a topic and list 2-3 specific learning tasks.`;
            const schema = {
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
            };
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: { responseMimeType: 'application/json', responseSchema: schema }
            });
            const planData = JSON.parse(response.text);
            const newPlan: StudyPlan = { ...planData, id: `plan_${Date.now()}` };
            
            // Initialize completed status for tasks
            newPlan.weeks.forEach(week => {
                week.days.forEach(day => {
                    day.tasks.forEach(task => task.completed = false);
                });
            });

            onSave(newPlan);
        } catch (error) {
            console.error("Study plan generation failed:", error);
            addNotification("Failed to generate study plan. Please try again.", "error");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Modal onClose={onClose}>
            <div className="modal-header">
                <h3>Generate AI Study Plan</h3>
                <button onClick={onClose} className="modal-close-btn"><Icon name="close" /></button>
            </div>
            <div className="modal-body">
                <p className="text-secondary mb-4">Let our AI assistant create a personalized study schedule for you.</p>
                <div className="control-group">
                    <label htmlFor="study-topic">Subject / Topic</label>
                    <input id="study-topic" type="text" className="form-control" value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g., Advanced JavaScript and React" />
                </div>
                <div className="control-group">
                    <label htmlFor="study-duration">Duration (in weeks)</label>
                    <input id="study-duration" type="number" className="form-control" value={duration} onChange={e => setDuration(Number(e.target.value))} min="1" max="12" />
                </div>
            </div>
            <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={handleGenerate} disabled={isLoading || !topic.trim()}>
                    {isLoading ? <><span className="spinner"></span> Generating...</> : <><Icon name="sparkles" className="w-4 h-4" /> Generate Plan</>}
                </button>
            </div>
        </Modal>
    );
};

const AITimetableAssistant = ({ onClose, settings, addNotification, timetable, setTimetable, filter }: { onClose: () => void, settings: AppSettings, addNotification: (m: string, t: AppNotification['type']) => void, timetable: TimetableEntry[], setTimetable: React.Dispatch<React.SetStateAction<TimetableEntry[]>>, filter: { department: string, year: string | undefined } }) => {
    const [prompt, setPrompt] = useState('');
    const [generatedEntries, setGeneratedEntries] = useState<TimetableEntry[] | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const handleGenerate = async () => {
        if (!ai || !prompt) {
            addNotification("Please provide instructions for the timetable.", "warning");
            return;
        }
        setIsLoading(true);
        setGeneratedEntries(null);
        try {
            const existingSchedule = timetable.filter(e => e.department === filter.department && e.year === filter.year).map(e => `${e.day} at ${settings.timeSlots[e.timeIndex]}: ${e.subject}`).join(', ');

            const aiPrompt = `
                You are an AI assistant creating a weekly class schedule for a college.
                Department: ${filter.department}
                Year: ${filter.year}
                Available Time Slots with their index: ${settings.timeSlots.map((s, i) => `${s} (index ${i})`).join(', ')}
                Days of the week: ${DAYS.join(', ')}

                Existing schedule for this department/year to avoid conflicts: ${existingSchedule || 'None'}

                User's instructions: "${prompt}"

                Generate a list of new timetable entries based on the instructions. Adhere strictly to the provided time slots and their indices. Provide subjects, faculty, and room numbers if specified. The output must be a valid JSON array. If a user asks for a time that spans multiple slots (e.g., 2pm to 4pm), create separate entries for each slot index.
            `;

            const schema = {
                type: Type.OBJECT,
                properties: {
                    schedule: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                day: { type: Type.STRING, enum: DAYS },
                                timeIndex: { type: Type.INTEGER },
                                subject: { type: Type.STRING },
                                type: { type: Type.STRING, enum: ['class', 'lab', 'break', 'common'] },
                                faculty: { type: Type.STRING },
                                room: { type: Type.STRING }
                            }
                        }
                    }
                }
            };

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: aiPrompt,
                config: { responseMimeType: 'application/json', responseSchema: schema }
            });

            const result = JSON.parse(response.text);
            const newEntries: TimetableEntry[] = result.schedule.map((item: any) => ({
                ...item,
                id: `ai_${Date.now()}_${Math.random()}`,
                department: filter.department,
                year: filter.year || 'I'
            })).filter((e: TimetableEntry) => e.timeIndex >= 0 && e.timeIndex < settings.timeSlots.length); // Filter out invalid time indices
            setGeneratedEntries(newEntries);
        } catch (error) {
            console.error("Timetable generation failed:", error);
            addNotification("Failed to generate timetable. The request might be too complex or invalid. Please try again with clearer instructions.", "error");
        } finally {
            setIsLoading(false);
        }
    };

    const handleApplyChanges = () => {
        if (!generatedEntries) return;
        // Basic conflict check: remove existing entries at the same slot
        const updatedTimetable = timetable.filter(entry => {
            if (entry.department !== filter.department || entry.year !== filter.year) {
                return true;
            }
            // Check if a generated entry will replace this slot
            return !generatedEntries.some(gen => gen.day === entry.day && gen.timeIndex === entry.timeIndex);
        });

        const finalTimetable = [...updatedTimetable, ...generatedEntries.map(e => ({...e, id: `tt_${Date.now()}_${Math.random()}`}))];
        setTimetable(finalTimetable);
        addNotification(`${generatedEntries.length} new entries added to the timetable.`, "success");
        onClose();
    };

    return (
        <Modal onClose={onClose} size="large">
            <div className="modal-header">
                <h3>AI Timetable Assistant</h3>
                <button onClick={onClose} className="modal-close-btn"><Icon name="close" /></button>
            </div>
            <div className="modal-body">
                <p className="text-secondary mb-4">Describe the timetable you want to create. For example: "Add Data Structures class with Prof. Chen in CS101 on Monday at 9am. Add an Algorithms lab on Wednesday from 2pm to 4pm."</p>
                <div className="control-group">
                    <label htmlFor="ai-timetable-prompt">Instructions</label>
                    <textarea id="ai-timetable-prompt" rows={4} className="form-control" value={prompt} onChange={e => setPrompt(e.target.value)} />
                </div>
                <div className="flex justify-end">
                    <button className="btn btn-primary" onClick={handleGenerate} disabled={isLoading || !prompt.trim()}>
                         {isLoading ? <><span className="spinner"></span> Generating...</> : <><Icon name="sparkles" className="w-4 h-4" /> Generate Preview</>}
                    </button>
                </div>
                {generatedEntries && (
                    <div className="mt-4">
                        <h4 className="font-semibold">Generated Preview</h4>
                        {generatedEntries.length > 0 ? (
                            <ul className="list-disc pl-5 mt-2 text-sm text-secondary">
                                {generatedEntries.map(entry => (
                                    <li key={entry.id}>
                                        <strong>{entry.day}, {settings.timeSlots[entry.timeIndex]}:</strong> {entry.subject} ({entry.type})
                                        {entry.faculty && ` with ${entry.faculty}`}
                                        {entry.room && ` in ${entry.room}`}
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-secondary text-sm mt-2">The AI could not generate any entries based on your instructions. Please try being more specific.</p>
                        )}
                    </div>
                )}
            </div>
            <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={handleApplyChanges} disabled={!generatedEntries || generatedEntries.length === 0}>
                    Apply Changes
                </button>
            </div>
        </Modal>
    );
};

const NotificationCenter = ({ notifications, onClear, onClose }: { notifications: HistoricalNotification[], onClear: () => void, onClose: () => void }) => {
    const centerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (centerRef.current && !centerRef.current.contains(event.target as Node)) {
                const target = event.target as HTMLElement;
                // Don't close if clicking the bell icon again
                if(!target.closest('.header-action-btn')) {
                    onClose();
                }
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [onClose]);

    return (
        <div className="notification-center" ref={centerRef}>
            <div className="notification-center-header">
                <h4>Notifications</h4>
                <button className="btn-link" onClick={onClear}>Clear All</button>
            </div>
            <div className="notification-center-body">
                {notifications.length > 0 ? (
                    notifications.map(n => (
                        <div key={n.id} className={`notification-item ${n.isRead ? 'read' : ''}`}>
                            <div className={`notification-icon icon-${n.type}`}>
                                <Icon name={n.type} />
                            </div>
                            <div className="notification-content">
                                <p>{n.message}</p>
                                <span className="timestamp">{formatRelativeTime(n.timestamp)}</span>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="empty-notifications">
                        <Icon name="bell" className="w-12 h-12 text-secondary opacity-50 mb-2"/>
                        <p className="text-secondary">No notifications yet.</p>
                    </div>
                )}
            </div>
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
                            <div className="flex justify-between items-center mb-2">
                                <label htmlFor="ann-content" className="!mb-0">Content</label>
                                <div className="ai-generator-section">
                                    <button type="button" className="btn btn-secondary btn-sm" onClick={handleGenerateContent} disabled={isAiGenerating || !isAiEnabled || !formData.title.trim()}>
                                        {isAiGenerating ? <span className="spinner"></span> : <Icon name="sparkles" className="w-4 h-4"/>}
                                        {isAiGenerating ? 'Generating...' : 'Generate with AI'}
                                    </button>
                                </div>
                            </div>
                            {!isAiEnabled && <p className="text-xs text-secondary mt-1">AI features disabled. API key not set.</p>}
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
            <div className="calendar-container">
                <div className="calendar-header">
                    <div className="calendar-nav">
                        <button onClick={handlePrevMonth}><Icon name="chevron-left" /></button>
                        <h2 className="text-xl font-bold">{currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}</h2>
                        <button onClick={handleNextMonth}><Icon name="chevron-right" /></button>
                        <button onClick={handleToday} className="btn btn-secondary btn-sm">Today</button>
                    </div>
                    <div className="calendar-filters">
                        {Object.keys(filters).map(key => (
                            <label key={key} className="filter-checkbox">
                                <input type="checkbox" checked={filters[key as keyof typeof filters]} onChange={() => handleFilterChange(key as keyof typeof filters)} />
                                <span className={`status-badge status-${key}`}>{key}</span>
                            </label>
                        ))}
                    </div>
                </div>
                <div className="calendar-grid">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => <div key={day} className="calendar-day-header">{day}</div>)}
                    {days.map(({ day, date }, index) => {
                        const dateStr = date ? date.toISOString().split('T')[0] : '';
                        const dayEvents = date ? eventsByDate.get(dateStr) || [] : [];
                        const isToday = dateStr === new Date().toISOString().split('T')[0];
                        const isAdmin = ['admin', 'hod', 'principal'].includes(currentUser.role);
                        return (
                            <div key={index} className={`calendar-day ${!day ? 'empty' : ''} ${isToday ? 'today' : ''} ${isAdmin ? 'editable' : ''}`} onClick={() => date && openModal(null, date)}>
                                {day && <span className="day-number">{day}</span>}
                                {dayEvents.map(event => (
                                    <div key={event.id} className={`calendar-event event-${event.type}`} onClick={(e) => { e.stopPropagation(); openModal(event); }}>
                                        {event.title}
                                    </div>
                                ))}
                            </div>
                        );
                    })}
                </div>
            </div>
            {isModalOpen && selectedEvent && <CalendarEventModal event={selectedEvent} onSave={handleSaveEvent} onDelete={handleDeleteEvent} onClose={() => setIsModalOpen(false)} />}
        </>
    );
};

const ResourcesView = ({ resources, setResources, currentUser, addNotification }: { resources: Resource[], setResources: React.Dispatch<React.SetStateAction<Resource[]>>, currentUser: User, addNotification: (message: string, type: AppNotification['type']) => void }) => {
    const [filter, setFilter] = useState({ department: 'all', type: 'all' });
    const [editingResource, setEditingResource] = useState<Resource | null>(null);
    const [isGapAnalysisModalOpen, setGapAnalysisModalOpen] = useState(false);
    const canManage = ['faculty', 'hod', 'admin', 'principal', 'creator'].includes(currentUser.role);

    const filteredResources = useMemo(() => {
        return resources
            .filter(r => (filter.department === 'all' || r.department === filter.department) && (filter.type === 'all' || r.type === filter.type))
            .sort((a, b) => b.timestamp - a.timestamp);
    }, [resources, filter]);

    const handleSave = (resource: Resource) => {
        if (resources.find(r => r.id === resource.id)) {
            setResources(prev => prev.map(r => r.id === resource.id ? resource : r));
            addNotification("Resource updated successfully", "success");
        } else {
            setResources(prev => [resource, ...prev]);
            addNotification("Resource uploaded successfully", "success");
        }
        setEditingResource(null);
    };

    const handleDelete = (id: string) => {
        if (window.confirm("Are you sure you want to delete this resource?")) {
            setResources(prev => prev.filter(r => r.id !== id));
            addNotification("Resource deleted", "info");
        }
    };
    
    const openEditor = () => {
        setEditingResource({
            id: `res_${Date.now()}`,
            name: '',
            type: 'notes',
            department: currentUser.dept,
            subject: '',
            uploaderId: currentUser.id,
            uploaderName: currentUser.name,
            timestamp: Date.now(),
        });
    };
    
    const AIGapAnalysisModal = ({ onClose }: { onClose: () => void }) => {
        const [department, setDepartment] = useState(DEPARTMENTS[0]);
        const [isLoading, setIsLoading] = useState(false);
        const [results, setResults] = useState<{ strengths: string[], gaps: string[], recommendations: string[] } | null>(null);

        const handleAnalyze = async () => {
            if (!ai) {
                addNotification("AI features are disabled.", "warning");
                return;
            }
            setIsLoading(true);
            setResults(null);
            try {
                const departmentResources = resources
                    .filter(r => r.department === department)
                    .map(r => `${r.name} (${r.type} for ${r.subject})`)
                    .join(', ');

                const prompt = `
                    Analyze the following list of academic resources for the ${department} department to identify curriculum gaps.
                    Resources: [${departmentResources || 'None available'}]
                    Based on this list, identify:
                    1. Strengths: Well-covered subjects or topics.
                    2. Gaps: Subjects or topics that appear to be missing or under-represented.
                    3. Recommendations: Suggest 3 specific new resources (like notes, textbooks, or projects) to create or acquire that would fill these gaps.
                `;

                const schema = {
                    type: Type.OBJECT,
                    properties: {
                        strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
                        gaps: { type: Type.ARRAY, items: { type: Type.STRING } },
                        recommendations: { type: Type.ARRAY, items: { type: Type.STRING } }
                    }
                };

                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: prompt,
                    config: { responseMimeType: 'application/json', responseSchema: schema }
                });

                setResults(JSON.parse(response.text));
            } catch (error) {
                console.error("AI Gap Analysis failed:", error);
                addNotification("Failed to perform AI analysis. Please try again.", "error");
            } finally {
                setIsLoading(false);
            }
        };

        return (
            <Modal onClose={onClose} size="large">
                <div className="modal-header">
                    <h3>AI Resource Gap Analysis</h3>
                    <button onClick={onClose} className="modal-close-btn"><Icon name="close" /></button>
                </div>
                <div className="modal-body">
                    <p className="text-secondary mb-4">Select a department to analyze its resource coverage and identify potential curriculum gaps.</p>
                    <div className="control-group">
                        <label htmlFor="dept-analysis">Department</label>
                        <select id="dept-analysis" className="form-control" value={department} onChange={e => setDepartment(e.target.value)}>
                            {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                    </div>
                    {isLoading && (
                         <div className="text-center py-8">
                             <span className="spinner"></span>
                             <p className="text-secondary mt-2">Analyzing resources...</p>
                         </div>
                    )}
                    {results && (
                        <div className="analysis-results-container">
                            <div className="analysis-result-section">
                                <h4><Icon name="check" className="text-green-500"/>Strengths</h4>
                                <ul>{results.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                            </div>
                            <div className="analysis-result-section">
                                <h4><Icon name="search" className="text-yellow-500"/>Identified Gaps</h4>
                                <ul>{results.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
                            </div>
                            <div className="analysis-result-section">
                                <h4><Icon name="lightbulb" className="text-blue-500"/>Recommendations</h4>
                                <ul>{results.recommendations.map((r, i) => <li key={i}>{r}</li>)}</ul>
                            </div>
                        </div>
                    )}
                </div>
                <div className="modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
                    <button type="button" className="btn btn-primary" onClick={handleAnalyze} disabled={isLoading}>
                         {isLoading ? 'Analyzing...' : <><Icon name="sparkles" className="w-4 h-4"/> Analyze</>}
                    </button>
                </div>
            </Modal>
        );
    };

    const ResourceModal = ({ resource, onSave, onClose }: { resource: Resource, onSave: (r: Resource) => void, onClose: () => void }) => {
        const [formData, setFormData] = useState(resource);

        return (
            <Modal onClose={onClose}>
                <form onSubmit={(e) => { e.preventDefault(); onSave(formData); }}>
                    <div className="modal-header">
                        <h3>{resource.name ? 'Edit Resource' : 'Upload Resource'}</h3>
                        <button type="button" onClick={onClose} className="modal-close-btn"><Icon name="close" /></button>
                    </div>
                    <div className="modal-body">
                        <div className="control-group">
                            <label htmlFor="res-name">Resource Name</label>
                            <input id="res-name" type="text" className="form-control" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} required />
                        </div>
                        <div className="form-grid">
                            <div className="control-group">
                                <label htmlFor="res-type">Type</label>
                                <select id="res-type" className="form-control" value={formData.type} onChange={e => setFormData({ ...formData, type: e.target.value as Resource['type'] })}>
                                    <option value="notes">Notes</option>
                                    <option value="book">Book</option>
                                    <option value="project">Project</option>
                                    <option value="lab">Lab Manual</option>
                                    <option value="other">Other</option>
                                </select>
                            </div>
                             <div className="control-group">
                                <label htmlFor="res-dept">Department</label>
                                <select id="res-dept" className="form-control" value={formData.department} onChange={e => setFormData({ ...formData, department: e.target.value })}>
                                   {DEPARTMENTS.map(dept => <option key={dept} value={dept}>{dept}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="control-group">
                            <label htmlFor="res-subject">Subject</label>
                            <input id="res-subject" type="text" className="form-control" value={formData.subject} onChange={e => setFormData({ ...formData, subject: e.target.value })} required />
                        </div>
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary">Save</button>
                    </div>
                </form>
            </Modal>
        );
    };
    
    const resourceIconMap: { [key in Resource['type']]: string } = { book: 'book', notes: 'notes', project: 'project', lab: 'lab', other: 'other' };

    return (
        <>
            <div className="view-header">
                <h2 className="text-2xl font-bold">Resources</h2>
                <div className="flex gap-2">
                    {['hod', 'admin', 'principal'].includes(currentUser.role) && (
                        <button className="btn btn-secondary" onClick={() => setGapAnalysisModalOpen(true)}>
                            <Icon name="sparkles" className="w-4 h-4" /> AI Gap Analysis
                        </button>
                    )}
                    {canManage && (
                        <button className="btn btn-primary" onClick={openEditor}>
                            <Icon name="upload" className="w-4 h-4" /> Upload Resource
                        </button>
                    )}
                </div>
            </div>
             <div className="table-wrapper">
                <table className="entry-list-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Department</th>
                            <th>Subject</th>
                            <th>Uploaded By</th>
                            <th>Date</th>
                            {canManage && <th>Actions</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {filteredResources.map(res => (
                            <tr key={res.id}>
                                <td>
                                    <div className="flex items-center gap-2">
                                        <div className={`resource-icon-container resource-icon-bg-${res.type}`}>
                                            <Icon name={resourceIconMap[res.type]} className="w-5 h-5"/>
                                        </div>
                                        <span>{res.name}</span>
                                    </div>
                                </td>
                                <td>{res.department}</td>
                                <td>{res.subject}</td>
                                <td>{res.uploaderName}</td>
                                <td>{new Date(res.timestamp).toLocaleDateString()}</td>
                                {canManage && (
                                    <td>
                                        <div className="flex gap-2">
                                            <button className="btn-icon" onClick={() => setEditingResource(res)}><Icon name="edit" className="w-5 h-5"/></button>
                                            <button className="btn-icon icon-danger" onClick={() => handleDelete(res.id)}><Icon name="trash" className="w-5 h-5"/></button>
                                        </div>
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
             </div>
             {editingResource && <ResourceModal resource={editingResource} onSave={handleSave} onClose={() => setEditingResource(null)} />}
             {isGapAnalysisModalOpen && <AIGapAnalysisModal onClose={() => setGapAnalysisModalOpen(false)} />}
        </>
    );
};

const SettingsView = ({ settings, setSettings, addNotification, currentUser }: { settings: AppSettings; setSettings: React.Dispatch<React.SetStateAction<AppSettings>>; addNotification: (m: string, t: AppNotification['type']) => void; currentUser: User }) => {
    const [localSettings, setLocalSettings] = useState(settings);

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        setSettings(localSettings);
        addNotification("Settings saved successfully!", "success");
    };
    
    useEffect(() => {
        // Apply theme and colors
        document.documentElement.setAttribute('data-theme', localSettings.theme);
        const theme = THEMES.find(t => t.name === localSettings.activeTheme);
        if (theme) {
            Object.entries(theme.colors).forEach(([key, value]) => {
                document.documentElement.style.setProperty(key, value);
            });
        }
    }, [localSettings]);

    return (
        <>
            <div className="view-header">
                <h2 className="text-2xl font-bold">Settings</h2>
            </div>
            <div className="max-w-2xl mx-auto">
                <form onSubmit={handleSave} className="settings-form">
                    <div className="dashboard-card">
                         <h3 className="text-lg font-semibold mb-4">Appearance</h3>
                         <div className="form-grid">
                            <div className="control-group">
                                <label>Theme</label>
                                <div className="flex gap-4">
                                    <label><input type="radio" name="theme" value="light" checked={localSettings.theme === 'light'} onChange={e => setLocalSettings({...localSettings, theme: e.target.value as 'light' | 'dark' })}/> Light</label>
                                    <label><input type="radio" name="theme" value="dark" checked={localSettings.theme === 'dark'} onChange={e => setLocalSettings({...localSettings, theme: e.target.value as 'light' | 'dark' })}/> Dark</label>
                                </div>
                            </div>
                            <div className="control-group">
                                <label htmlFor="theme-color">Accent Color</label>
                                <select id="theme-color" className="form-control" value={localSettings.activeTheme} onChange={e => setLocalSettings({ ...localSettings, activeTheme: e.target.value })}>
                                    {THEMES.map(theme => <option key={theme.name} value={theme.name}>{theme.name}</option>)}
                                </select>
                            </div>
                         </div>
                    </div>
                    
                    {['admin', 'creator'].includes(currentUser.role) && (
                        <div className="dashboard-card mt-6">
                            <h3 className="text-lg font-semibold mb-4">Timetable Configuration</h3>
                            <div className="control-group">
                                <label>Time Slots</label>
                                {localSettings.timeSlots.map((slot, index) => (
                                    <div key={index} className="flex gap-2 mb-2">
                                        <input 
                                            type="text" 
                                            className="form-control" 
                                            value={slot} 
                                            onChange={e => {
                                                const newSlots = [...localSettings.timeSlots];
                                                newSlots[index] = e.target.value;
                                                setLocalSettings({ ...localSettings, timeSlots: newSlots });
                                            }}
                                        />
                                        <button 
                                            type="button" 
                                            className="btn btn-danger-outline btn-sm"
                                            onClick={() => {
                                                 const newSlots = localSettings.timeSlots.filter((_, i) => i !== index);
                                                 setLocalSettings({ ...localSettings, timeSlots: newSlots });
                                            }}
                                        >
                                            <Icon name="trash" />
                                        </button>
                                    </div>
                                ))}
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm mt-2"
                                    onClick={() => {
                                        setLocalSettings({ ...localSettings, timeSlots: [...localSettings.timeSlots, ''] });
                                    }}
                                >
                                   <Icon name="plus" /> Add Slot
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="mt-6 flex justify-end">
                        <button type="submit" className="btn btn-primary">Save Changes</button>
                    </div>
                </form>
            </div>
        </>
    );
};

const AIChat = ({ onHide }: { onHide: () => void; }) => {
    const [chat, setChat] = useState<Chat | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (ai) {
            const newChat = ai.chats.create({
                model: 'gemini-2.5-flash',
                config: {
                    systemInstruction: 'You are a helpful academic assistant for a college portal. Be concise and professional.',
                },
            });
            setChat(newChat);
        }
    }, []);
    
     useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || !chat || isLoading) return;

        const userMessage: ChatMessage = { id: `msg_${Date.now()}`, role: 'user', text: input };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);

        try {
            const responseStream = await chat.sendMessageStream({ message: input });
            let modelResponseText = '';
            let modelMessageId = `msg_${Date.now()}_model`;

            // Initialize model message
            setMessages(prev => [...prev, { id: modelMessageId, role: 'model', text: '...' }]);

            for await (const chunk of responseStream) {
                modelResponseText += chunk.text;
                setMessages(prev => prev.map(msg => 
                    msg.id === modelMessageId ? { ...msg, text: modelResponseText } : msg
                ));
            }
        } catch (error) {
            console.error("AI chat error:", error);
            setMessages(prev => [...prev, { id: `err_${Date.now()}`, role: 'model', text: "Sorry, I couldn't process that request.", isError: true }]);
        } finally {
            setIsLoading(false);
        }
    };
    
    const renderMessageContent = (text: string) => {
        const html = marked(text, { breaks: true });
        return <div dangerouslySetInnerHTML={{ __html: html as string }} />;
    };

    return (
        <div className="chat-widget">
            <div className="chat-widget-header">
                <h3>AI Assistant</h3>
                <button className="btn-icon" onClick={onHide}><Icon name="close" /></button>
            </div>
            <div className="chat-widget-body" ref={messagesEndRef}>
                {messages.length === 0 ? (
                    <div className="chat-empty">
                        <Icon name="robot" className="w-12 h-12 text-secondary opacity-50 mb-2" />
                        <p className="text-secondary text-sm">Ask me anything about the college!</p>
                    </div>
                ) : (
                    messages.map(msg => (
                        <div key={msg.id} className={`chat-message ${msg.role} ${msg.isError ? 'error' : ''}`}>
                            <div className="chat-bubble">{renderMessageContent(msg.text)}</div>
                        </div>
                    ))
                )}
                 {isLoading && messages[messages.length-1].role === 'user' && (
                    <div className="chat-message model">
                        <div className="chat-bubble"><span className="spinner"></span></div>
                    </div>
                )}
            </div>
            <div className="chat-widget-footer">
                <form onSubmit={handleSendMessage}>
                    <input
                        type="text"
                        className="form-control"
                        placeholder="Type a message..."
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        disabled={isLoading || !isAiEnabled}
                    />
                    <button type="submit" className="btn btn-primary" disabled={isLoading || !input.trim()}>
                        <Icon name="send" className="w-4 h-4" />
                    </button>
                </form>
            </div>
        </div>
    );
};

// --- App ---
const App = () => {
    const [currentUser, setCurrentUser] = useLocalStorage<User | null>('currentUser', null);
    const [view, setView] = useState<AppView>('dashboard');
    const [isSidebarOpen, setSidebarOpen] = useState(false);
    const [isChatVisible, setChatVisible] = useState(false);

    // Data states
    const [users, setUsers] = useLocalStorage<User[]>('users', initialUsers);
    const [timetable, setTimetable] = useLocalStorage<TimetableEntry[]>('timetable', initialTimetable);
    const [announcements, setAnnouncements] = useLocalStorage<Announcement[]>('announcements', initialAnnouncements);
    const [resources, setResources] = useLocalStorage<Resource[]>('resources', initialResources);
    const [courseFiles, setCourseFiles] = useLocalStorage<CourseFile[]>('courseFiles', initialCourseFiles);
    const [calendarEvents, setCalendarEvents] = useLocalStorage<CalendarEvent[]>('calendarEvents', initialCalendarEvents);
    const [securityAlerts, setSecurityAlerts] = useLocalStorage<SecurityAlert[]>('securityAlerts', initialSecurityAlerts);
    const [settings, setSettings] = useLocalStorage<AppSettings>('settings', initialAppSettings);
    const { notifications, toastQueue, addNotification, markAllAsRead, clearNotifications, unreadCount } = useAppNotifications();
    const [isNotificationsOpen, setNotificationsOpen] = useState(false);


    useEffect(() => {
        if (!currentUser) {
            setView('auth');
        } else {
            // Re-apply theme on load
            document.documentElement.setAttribute('data-theme', settings.theme);
             const theme = THEMES.find(t => t.name === settings.activeTheme);
            if (theme) {
                Object.entries(theme.colors).forEach(([key, value]) => {
                    document.documentElement.style.setProperty(key, value);
                });
            }
        }
    }, [currentUser, settings]);
    
    const handleLogout = () => {
        setCurrentUser(null);
        setView('auth');
    };
    
    const addUser = (user: User) => {
        setUsers(prev => [...prev, user]);
    };

    const handleViewChange = (newView: AppView) => {
        setView(newView);
        setSidebarOpen(false);
    }
    
    const handleBellClick = () => {
        if (!isNotificationsOpen) {
            markAllAsRead();
        }
        setNotificationsOpen(prev => !prev);
    };

    if (!currentUser) {
        return <AuthView setView={setView} setCurrentUser={setCurrentUser} users={users} addUser={addUser} addNotification={addNotification} />;
    }
    
    const navItems = [
        { name: 'Dashboard', icon: 'dashboard', view: 'dashboard', roles: ['student', 'faculty', 'hod', 'admin', 'principal', 'creator', 'class advisor'] },
        { name: 'Timetable', icon: 'timetable', view: 'timetable', roles: ['student', 'faculty', 'hod', 'admin', 'principal', 'creator', 'class advisor'] },
        { name: 'Announcements', icon: 'announcements', view: 'announcements', roles: ['student', 'faculty', 'hod', 'admin', 'principal', 'creator'] },
        { name: 'Resources', icon: 'resources', view: 'resources', roles: ['student', 'faculty', 'hod', 'admin', 'principal', 'creator'] },
        { name: 'Academic Calendar', icon: 'academicCalendar', view: 'academicCalendar', roles: ['student', 'faculty', 'hod', 'admin', 'principal', 'creator'] },
        { name: 'Career Counselor', icon: 'briefcase', view: 'careerCounselor', roles: ['student'] },
        { name: 'Course Files', icon: 'courseFiles', view: 'courseFiles', roles: ['faculty', 'hod', 'principal'] },
        { name: 'Student Analytics', icon: 'bar-chart', view: 'studentAnalytics', roles: ['hod', 'principal', 'class advisor'] },
        { name: 'User Approvals', icon: 'approvals', view: 'approvals', roles: ['admin', 'hod', 'principal'] },
        { name: 'User Management', icon: 'userManagement', view: 'userManagement', roles: ['admin', 'creator'] },
        { name: 'Security Center', icon: 'security', view: 'security', roles: ['admin'] },
    ];
    
    const getVisibleNavItems = () => navItems.filter(item => item.roles.includes(currentUser.role));

    return (
        <div className={`app-container ${isSidebarOpen ? 'sidebar-open' : ''}`}>
             <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)}></div>
            <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
                <div className="sidebar-header">
                    <span className="logo"><Icon name="dashboard" /></span>
                    <h1>AcademiaAI</h1>
                     <button className="sidebar-close" onClick={() => setSidebarOpen(false)}><Icon name="close" /></button>
                </div>
                <nav className="nav-list">
                    <ul>
                        {getVisibleNavItems().map(item => (
                            <li key={item.view} className="nav-item">
                                <button
                                    className={view === item.view ? 'active' : ''}
                                    onClick={() => handleViewChange(item.view as AppView)}
                                >
                                    <Icon name={item.icon} />
                                    <span>{item.name}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </nav>
                 <div className="sidebar-footer">
                    <div className="nav-item">
                        <button onClick={() => handleViewChange('settings')}>
                            <Icon name="settings" />
                            <span>Settings</span>
                        </button>
                    </div>
                     <div className="nav-item">
                        <button onClick={handleLogout} className="logout-btn">
                            <Icon name="logout" />
                             <span>Logout</span>
                        </button>
                    </div>
                </div>
            </aside>
            <main className="main-content">
                <header className="header">
                     <div className="header-left">
                        <button className="menu-toggle" onClick={() => setSidebarOpen(true)}><Icon name="menu" /></button>
                        <h2 className="header-title">{view.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}</h2>
                    </div>
                    <div className="header-right">
                        <button className="header-action-btn" onClick={handleBellClick}>
                            <Icon name="bell" />
                            {unreadCount > 0 && <span className="notification-badge">{unreadCount}</span>}
                        </button>
                        {isNotificationsOpen && <NotificationCenter notifications={notifications} onClear={clearNotifications} onClose={() => setNotificationsOpen(false)} />}
                    </div>
                </header>
                <div className="page-content">
                    {view === 'dashboard' && <DashboardView currentUser={currentUser} announcements={announcements} calendarEvents={calendarEvents} users={users} securityAlerts={securityAlerts} setView={setView} setUsers={setUsers} addNotification={addNotification} />}
                    {view === 'timetable' && <TimetableView currentUser={currentUser} timetable={timetable} settings={settings} setTimetable={setTimetable} addNotification={addNotification} />}
                    {view === 'announcements' && <AnnouncementsView announcements={announcements} setAnnouncements={setAnnouncements} currentUser={currentUser} addNotification={addNotification} />}
                    {view === 'academicCalendar' && <AcademicCalendarView events={calendarEvents} setEvents={setCalendarEvents} currentUser={currentUser} addNotification={addNotification} />}
                    {view === 'resources' && <ResourcesView resources={resources} setResources={setResources} currentUser={currentUser} addNotification={addNotification} />}
                    {view === 'settings' && <SettingsView settings={settings} setSettings={setSettings} addNotification={addNotification} currentUser={currentUser} />}
                </div>
            </main>
            {isAiEnabled && (
                <>
                    {!isChatVisible && <button className="chat-fab" onClick={() => setChatVisible(true)}><Icon name="robot" /></button>}
                    {isChatVisible && <AIChat onHide={() => setChatVisible(false)} />}
                </>
            )}
            <div className="toast-container">
                {toastQueue.map(n => <NotificationToast key={n.id} notification={n} onRemove={() => {}} />)}
            </div>
        </div>
    );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);