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
    status: 'active' | 'pending_approval' | 'rejected' | 'locked';
    aiSummary?: {
        profile: string;
        standing: string;
        note: string;
    };
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
    registeredAt?: number;
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
    aiTriage?: {
        impact: string;
        priority: string;
        recommendedNextStep: string;
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
// FIX: Added 'creator' to ROLES to match the UserRole type and initialUsers data.
const ROLES: UserRole[] = ['student', 'faculty', 'hod', 'admin', 'class advisor', 'principal', 'creator'];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const THEMES: AppTheme[] = [
    { name: 'Default Blue', colors: { '--accent-primary': '#3B82F6', '--accent-primary-hover': '#2563EB' } },
    { name: 'Ocean Green', colors: { '--accent-primary': '#10b981', '--accent-primary-hover': '#059669' } },
    { name: 'Sunset Orange', colors: { '--accent-primary': '#f59e0b', '--accent-primary-hover': '#d97706' } },
    { name: 'Royal Purple', colors: { '--accent-primary': '#8b5cf6', '--accent-primary-hover': '#7c3aed' } },
];

// --- MOCK DATA ---
const initialUsers: User[] = [
    { id: 'user_1', name: 'Dr. Evelyn Reed', role: 'principal', dept: 'Administration', status: 'active', isLocked: false, registeredAt: Date.now() - 86400000 * 10 },
    { id: 'user_2', name: 'Admin User', role: 'admin', dept: 'IT', status: 'active', isLocked: false, registeredAt: Date.now() - 86400000 * 10 },
    { id: 'user_3', name: 'Prof. Samuel Chen', role: 'hod', dept: 'CSE', status: 'active', isLocked: false, registeredAt: Date.now() - 86400000 * 8 },
    { id: 'user_4', name: 'Prof. Aisha Khan', role: 'faculty', dept: 'ECE', status: 'active', isLocked: false, registeredAt: Date.now() - 86400000 * 7 },
    { id: 'user_5', name: 'John Doe', role: 'student', dept: 'CSE', year: 'II', status: 'active', grades: [{ subject: 'Data Structures', score: 85 }, { subject: 'Algorithms', score: 92 }, { subject: 'DBMS', score: 78 }, { subject: 'OS', score: 88 }], attendance: { present: 78, total: 85 }, isLocked: false, studyPlans: [], careerProfile: { interests: ['Web Development', 'AI/ML'], skills: ['React', 'Python'], careerGoals: 'Become a full-stack developer at a tech company.' }, registeredAt: Date.now() - 86400000 * 5 },
    { id: 'user_6', name: 'Jane Smith', role: 'student', dept: 'CSE', year: 'II', status: 'pending_approval', isLocked: false, studyPlans: [], registeredAt: Date.now() - 86400000 * 2 },
    { id: 'user_7', name: 'Creator', role: 'creator', dept: 'IT', status: 'active', isLocked: false, registeredAt: Date.now() - 86400000 * 10 },
    { id: 'user_8', name: 'Emily White', role: 'student', dept: 'ECE', year: 'I', status: 'active', grades: [{ subject: 'Basic Electronics', score: 55 }, { subject: 'Circuit Theory', score: 62 }], attendance: { present: 60, total: 85 }, isLocked: false, studyPlans: [], registeredAt: Date.now() - 86400000 * 4 }
];

const initialTimetable: TimetableEntry[] = [
    { id: 'tt_1', department: 'CSE', year: 'II', day: 'Monday', timeIndex: 0, subject: 'Data Structures', type: 'class', faculty: 'Prof. Chen', room: 'CS101' },
    { id: 'tt_2', department: 'CSE', year: 'II', day: 'Monday', timeIndex: 1, subject: 'Algorithms', type: 'class', faculty: 'Dr. Reed', room: 'CS102' },
    { id: 'tt_3', department: 'CSE', year: 'II', day: 'Tuesday', timeIndex: 2, subject: 'Database Systems', type: 'class', faculty: 'Prof. Khan', room: 'CS101' },
    { id: 'tt_4', department: 'CSE', year: 'II', day: 'Monday', timeIndex: 2, subject: 'Break', type: 'break' },
];

const initialAnnouncements: Announcement[] = [
    { id: 'ann_1', title: 'Mid-term Exam Schedule', content: 'The mid-term exam schedule for all departments has been published. Please check the notice board.\n\n### Key Dates\n- **Start Date:** October 25th\n- **End Date:** November 5th', author: 'Dr. Evelyn Reed', authorId: 'user_1', timestamp: Date.now() - 86400000, targetRole: 'all', targetDept: 'all' },
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
     { id: 'sec_1', type: 'Anomaly', title: 'Multiple Failed Logins', description: 'User account for "John Doe" (user_5) had 5 failed login attempts.', timestamp: Date.now() - 3600000, severity: 'medium', relatedUserId: 'user_5', isResolved: false },
     { id: 'sec_2', type: 'Threat', title: 'Suspected Phishing Link', description: 'A resource uploaded by Prof. Khan contained a suspicious URL.', timestamp: Date.now() - 86400000, severity: 'high', relatedUserId: 'user_4', isResolved: true },
     { id: 'sec_3', type: 'Threat', title: 'Unauthorized Dept Change', description: 'User Jane Smith (user_6) attempted to change department settings.', timestamp: Date.now() - 172800000, severity: 'critical', relatedUserId: 'user_6', isResolved: false },
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

    const removeNotification = (id: string) => {
        setToastQueue(prev => prev.filter(n => n.id !== id));
    };

    const markAllAsRead = () => {
        setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    };
    
    const clearNotifications = () => {
        setNotifications([]);
    };

    const unreadCount = useMemo(() => notifications.filter(n => !n.isRead).length, [notifications]);

    return { notifications, toastQueue, addNotification, markAllAsRead, clearNotifications, unreadCount, removeNotification };
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
        settings: <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-1.007 1.11-1.11h2.596c.55.103 1.02.568 1.11 1.11l.09 1.586c.294.049.58.12.856.216l1.373-.793c.49-.283 1.096-.046 1.378.444l1.3 2.252c.282.49-.046 1.096-.444 1.378l-1.148.664c.06.27.11.543.15.82l.09 1.586c-.103.55-.568 1.02-1.11 1.11h-2.596c-.55-.103-1.02-.568-1.11-1.11l-.09-1.586a7.447 7.447 0 01-.856-.216l-1.373.793c-.49.283-1.096.046-1.378-.444l-1.3-2.252c-.282.49.046 1.096.444-1.378l1.148-.664a7.452 7.452 0 01.15-.82l.09-1.586zM12 15a3 3 0 100-6 3 3 0 000 6z" />,
        announcements: <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 3.34a1.5 1.5 0 011.32 0l6.68 4.175a1.5 1.5 0 010 2.65L11.66 14.34a1.5 1.5 0 01-1.32 0L3.66 10.165a1.5 1.5 0 010-2.65l6.68-4.175zM10 5.114L4.93 8.334 10 11.554l5.07-3.22-5.07-3.22zM4.5 12.334L10 15.666l5.5-3.332" />,
        resources: <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15a2.25 2.25 0 002.25-2.25V6a2.25 2.25 0 00-2.25-2.25h-5.19a1.5 1.5 0 00-1.06-.44l-2.12-2.12z" />,
        userManagement: <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-4.663M12 12a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />,
        security: <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.286zm0 13.036h.008v.008h-.008v-.008z" />,
        studentDirectory: <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5z" />,
        academicCalendar: <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0h18" />,
        courseFiles: <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />,
        studentAnalytics: <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />,
        careerCounselor: <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />,
        logout: <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />,
        menu: <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />,
        close: <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />,
        bell: <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.31 5.632l-1.42 1.42A9 9 0 009 22.5h6a9 9 0 00.106-5.418z" />,
        chevronDown: <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />,
        plus: <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />,
        search: <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />,
        edit: <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />,
        delete: <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />,
        info: <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />,
        warning: <path fillRule="evenodd" d="M10 1.944A1.5 1.5 0 0111.5 3v8.5a1.5 1.5 0 01-3 0V3A1.5 1.5 0 0110 1.944zM10 18a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />,
        error: <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />,
        success: <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />,
        book: <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />,
        notes: <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />,
        project: <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h6M9 11.25h6m-6 4.5h6M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM20.25 6.75h.007v.008h-.007V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />,
        lab: <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 6.087c0-.595.44-1.088 1.03-1.088h.01M15.29 5.002c.36-.002.71.124 1 .334l.32.16c.33.165.68.277 1.05.324l.35.043c.58.073 1.05.556 1.05 1.137v2.44c0 .58-.47 1.063-1.05 1.137l-.35.043c-.37.047-.72.16-1.05.324l-.32.16c-.29.21-.64.336-1 .334h-.01c-.59 0-1.03-.493-1.03-1.088v-4.626c0-.595.44-1.088 1.03-1.088zm-6 0c0-.595.44-1.088 1.03-1.088h.01c.59 0 1.03.493 1.03 1.088v4.626c0 .595-.44 1.088-1.03 1.088h-.01c-.59 0-1.03-.493-1.03-1.088V6.087zM5.318 14.44a1.5 1.5 0 01.733-1.282l.32-.16c.33-.165.68-.277 1.05-.324l.35-.043A1.125 1.125 0 019 13.875v2.44c0 .58-.47 1.063-1.05 1.137l-.35.043c-.37.047-.72.16-1.05.324l-.32.16a1.5 1.5 0 01-1.282-.733 9.041 9.041 0 01-.39-3.033c.125-.26.26-.516.402-.767z" />,
        other: <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.452-2.452L14.25 6l1.036-.259a3.375 3.375 0 002.452-2.452L18 2.25l.259 1.035a3.375 3.375 0 002.452 2.452L21.75 6l-1.035.259a3.375 3.375 0 00-2.452 2.452zM12.282 17.618L12 18.75l-.282-1.132a3.375 3.375 0 00-2.43-2.43L8.25 15l1.132-.282a3.375 3.375 0 002.43-2.43L12 11.25l.282 1.132a3.375 3.375 0 002.43 2.43L15.75 15l-1.132.282a3.375 3.375 0 00-2.43 2.43z" />,
        sparkles: <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.452-2.452L14.25 6l1.036-.259a3.375 3.375 0 002.452-2.452L18 2.25l.259 1.035a3.375 3.375 0 002.452 2.452L21.75 6l-1.035.259a3.375 3.375 0 00-2.452 2.452zM12.282 17.618L12 18.75l-.282-1.132a3.375 3.375 0 00-2.43-2.43L8.25 15l1.132-.282a3.375 3.375 0 002.43-2.43L12 11.25l.282 1.132a3.375 3.375 0 002.43 2.43L15.75 15l-1.132.282a3.375 3.375 0 00-2.43 2.43z" />,
        upload: <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />,
        download: <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />,
        eye: <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.432 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />,
        send: <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />,
        left: <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />,
        right: <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />,
    };

    return (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
            {icons[name]}
        </svg>
    );
};

const Modal = ({ children, onClose, title, size = 'medium' }: { children: React.ReactNode, onClose: () => void, title: string, size?: 'medium' | 'large' }) => {
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
                <div className="modal-header">
                    <h3>{title}</h3>
                    <button onClick={onClose} className="modal-close-btn" aria-label="Close modal">
                        <Icon name="close" className="w-6 h-6" />
                    </button>
                </div>
                {children}
            </div>
        </div>,
        document.body
    );
};

const ToastContainer = ({ toasts, removeToast }: { toasts: AppNotification[], removeToast: (id: string) => void }) => {
    return createPortal(
        <div className="toast-container">
            {toasts.map(toast => (
                <div key={toast.id} className={`toast toast-${toast.type}`}>
                    <div className="toast-icon">
                        <Icon name={toast.type} />
                    </div>
                    <p>{toast.message}</p>
                    <button onClick={() => removeToast(toast.id)} className="toast-close-btn">
                        <Icon name="close" className="w-5 h-5" />
                    </button>
                </div>
            ))}
        </div>,
        document.body
    );
};

const BarChart = ({ data, title }: { data: { subject: string, score: number }[], title: string }) => {
    const maxScore = 100;
    return (
        <div className="bar-chart-container">
            <h4>{title}</h4>
            <div className="bar-chart">
                {data.map((item, index) => {
                    const barHeight = (item.score / maxScore) * 100;
                    const barColor = item.score < 50 ? 'var(--accent-danger)' : item.score < 75 ? 'var(--accent-warning)' : 'var(--accent-secondary)';
                    return (
                        <div className="chart-bar-group" key={index}>
                            <div className="chart-bar" style={{ height: `${barHeight}%`, backgroundColor: barColor }} data-tooltip={`${item.subject}: ${item.score}%`}></div>
                        </div>
                    );
                })}
            </div>
             <div className="chart-labels">
                {data.map((item, index) => (
                    <span key={index}>{item.subject}</span>
                ))}
            </div>
        </div>
    );
};

// --- VIEWS ---

function AuthView({ onLogin, onRegister, addNotification }: { onLogin: (id: string, name: string) => void, onRegister: (user: User) => void, addNotification: (message: string, type: AppNotification['type']) => void }) {
    const [isRegister, setIsRegister] = useState(false);
    const [name, setName] = useState('');
    const [id, setId] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState<UserRole>('student');
    const [dept, setDept] = useState('CSE');
    const [year, setYear] = useState('I');

    const handleLogin = (e: React.FormEvent) => {
        e.preventDefault();
        // Mock login: find user by ID. In a real app, you'd check the password too.
        const user = initialUsers.find(u => u.id === id);
        if (user) {
            onLogin(user.id, user.name);
            addNotification(`Welcome back, ${user.name}!`, 'success');
        } else {
            addNotification('Invalid user ID or password.', 'error');
        }
    };

    const handleRegister = (e: React.FormEvent) => {
        e.preventDefault();
        const newUser: User = {
            id: `user_${Date.now()}`,
            name,
            role,
            dept,
            year: role === 'student' ? year : undefined,
            status: 'pending_approval',
            registeredAt: Date.now(),
        };
        onRegister(newUser);
        addNotification('Registration successful! Your account is pending approval.', 'success');
        
        // Clear form and flip back
        setName('');
        setId('');
        setPassword('');
        setRole('student');
        setDept('CSE');
        setYear('I');
        setIsRegister(false);
    };

    return (
        <div className="login-view-container">
            <div className="login-card">
                <div className={`login-card-inner ${isRegister ? 'is-flipped' : ''}`}>
                    <div className="login-card-front">
                        <div className="login-header">
                            <span className="logo"><Icon name="academicCalendar" className="w-8 h-8"/></span>
                            <h1>Welcome Back</h1>
                            <p>Sign in to your Academic AI Assistant</p>
                        </div>
                        <form onSubmit={handleLogin}>
                             <div className="control-group">
                                <label htmlFor="login-id">User ID</label>
                                <input id="login-id" type="text" className="form-control" value={id} onChange={(e) => setId(e.target.value)} placeholder="e.g., user_5" required />
                            </div>
                            <div className="control-group">
                                <label htmlFor="login-password">Password</label>
                                <input id="login-password" type="password" className="form-control" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
                            </div>
                            <button type="submit" className="btn btn-primary w-full">Login</button>
                        </form>
                         <div className="auth-toggle">
                            Don't have an account? <button onClick={() => setIsRegister(true)}>Register</button>
                        </div>
                        <p className="auth-hint">Hint: Try ID `user_5` (student) or `user_2` (admin).</p>
                    </div>
                    <div className="login-card-back">
                        <div className="login-header">
                             <span className="logo"><Icon name="academicCalendar" className="w-8 h-8"/></span>
                            <h1>Create Account</h1>
                            <p>Join the Academic AI Assistant platform</p>
                        </div>
                        <form onSubmit={handleRegister}>
                            <div className="control-group">
                                <label htmlFor="reg-name">Full Name</label>
                                <input id="reg-name" type="text" className="form-control" value={name} onChange={(e) => setName(e.target.value)} required />
                            </div>
                             <div className="form-grid">
                                <div className="control-group">
                                    <label htmlFor="reg-role">Role</label>
                                    <select id="reg-role" className="form-control" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
                                        {ROLES.filter(r => ['student', 'faculty'].includes(r)).map(r => <option key={r} value={r} className="capitalize">{r}</option>)}
                                    </select>
                                </div>
                                <div className="control-group">
                                    <label htmlFor="reg-dept">Department</label>
                                    <select id="reg-dept" className="form-control" value={dept} onChange={(e) => setDept(e.target.value)}>
                                        {DEPARTMENTS.slice(0, 7).map(d => <option key={d} value={d}>{d}</option>)}
                                    </select>
                                </div>
                            </div>
                            {role === 'student' && (
                                <div className="control-group">
                                    <label htmlFor="reg-year">Year</label>
                                    <select id="reg-year" className="form-control" value={year} onChange={(e) => setYear(e.target.value)}>
                                        {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                                    </select>
                                </div>
                            )}
                            <button type="submit" className="btn btn-primary w-full">Register</button>
                        </form>
                        <div className="auth-toggle">
                            Already have an account? <button onClick={() => setIsRegister(false)}>Login</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function DashboardView({ user, announcements, timetable, settings, users, securityAlerts, setView }: { user: User; announcements: Announcement[]; timetable: TimetableEntry[]; settings: AppSettings; users: User[]; securityAlerts: SecurityAlert[]; setView: (view: AppView) => void; }) {
    const today = new Date().toLocaleString('en-us', { weekday: 'long' });

    const userTimetable = timetable.filter(entry =>
        (user.role === 'student' && entry.department === user.dept && entry.year === user.year && entry.day === today) ||
        (user.role !== 'student' && entry.faculty === user.name && entry.day === today)
    ).sort((a, b) => a.timeIndex - b.timeIndex);

    const relevantAnnouncements = announcements
        .filter(a =>
            (a.targetRole === 'all' || a.targetRole === user.role) &&
            (a.targetDept === 'all' || a.targetDept === user.dept)
        )
        .slice(0, 3);

    const getGreeting = () => {
        const hour = new Date().getHours();
        if (hour < 12) return "Good Morning";
        if (hour < 18) return "Good Afternoon";
        return "Good Evening";
    };

    const { pendingApprovals, atRiskStudents, activeAlerts, performance, systemStats } = useMemo(() => {
        const studentUsers = users.filter(u => u.role === 'student');
        return {
            pendingApprovals: users.filter(u => u.status === 'pending_approval'),
            atRiskStudents: studentUsers.filter(s => (s.attendance && (s.attendance.present / s.attendance.total) < 0.75) || (s.grades && s.grades.some(g => g.score < 50))),
            activeAlerts: securityAlerts.filter(a => !a.isResolved),
            performance: {
                avgGrade: user.grades && user.grades.length > 0 ? (user.grades.reduce((acc, g) => acc + g.score, 0) / user.grades.length).toFixed(1) : 'N/A',
                attendance: user.attendance ? ((user.attendance.present / user.attendance.total) * 100).toFixed(1) : 'N/A'
            },
            systemStats: {
                totalUsers: users.length,
                pendingUsers: users.filter(u => u.status === 'pending_approval').length
            }
        };
    }, [users, securityAlerts, user]);

    const [aiInsight, setAiInsight] = useState("Generating personalized insight...");
    const [isInsightLoading, setIsInsightLoading] = useState(true);

    useEffect(() => {
        const fetchAiInsight = async () => {
            if (!ai) {
                setAiInsight("AI features are disabled. Enable API_KEY to get insights.");
                setIsInsightLoading(false);
                return;
            }
            setIsInsightLoading(true);
            let prompt = "";
            const adminRoles: UserRole[] = ['hod', 'principal', 'admin', 'creator'];

            if (user.role === 'student') {
                prompt = `Generate a single, short, encouraging, and actionable insight for student ${user.name}. Focus on their academic data. Data: Grades - ${JSON.stringify(user.grades)}, Attendance - ${user.attendance?.present}/${user.attendance?.total}. Keep it under 25 words.`;
            } else if (adminRoles.includes(user.role)) {
                prompt = `Generate a single, short, and actionable administrative insight for ${user.role} ${user.name}. Focus on system-level data. Data: ${pendingApprovals.length} pending approvals, ${atRiskStudents.length} at-risk students, ${activeAlerts.length} active security alerts. Keep it under 25 words.`;
            } else {
                 setAiInsight("Have a productive day! Check your schedule and announcements.");
                 setIsInsightLoading(false);
                 return;
            }

            try {
                 const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: prompt,
                 });
                setAiInsight(response.text);
            } catch (error) {
                console.error("AI Insight Error:", error);
                setAiInsight("Could not generate an insight at this time.");
            } finally {
                setIsInsightLoading(false);
            }
        };

        fetchAiInsight();
    }, [user.role]); // Rerun only when user role changes to avoid spamming API on data change

    const StatCard = ({ icon, label, value, colorClass }: { icon: string, label: string, value: string | number, colorClass: string }) => (
        <div className="stat-card">
            <div className={`stat-card-icon ${colorClass}`}><Icon name={icon} /></div>
            <div className="stat-card-info">
                <div className="stat-label">{label}</div>
                <div className="stat-value">{value}</div>
            </div>
        </div>
    );
    
    const isAdminView = ['admin', 'hod', 'principal', 'creator'].includes(user.role);

    return (
        <div className="dashboard-container improved page-content">
            <div className="dashboard-header-section">
                <h2 className="dashboard-greeting">{getGreeting()}, {user.name.split(' ')[0]}!</h2>
                <p className="dashboard-subtitle">Here's a summary of what's important right now.</p>
            </div>

            <div className="dashboard-grid improved">
                <div className="dashboard-card full-width">
                     <div className="ai-insight-card">
                        <div className="feed-item-icon"><Icon name="sparkles" /></div>
                        <div>
                            <p><strong>AI Insight:</strong> {isInsightLoading ? <span className="text-secondary">Generating...</span> : aiInsight}</p>
                        </div>
                    </div>
                </div>

                {isAdminView ? (
                    <>
                        <div className="stat-grid">
                            <StatCard icon="userManagement" label="Total Users" value={systemStats.totalUsers} colorClass="bg-blue" />
                            <StatCard icon="timetable" label="Pending Approvals" value={systemStats.pendingUsers} colorClass="bg-orange" />
                            <StatCard icon="security" label="Active Alerts" value={activeAlerts.length} colorClass="bg-red" />
                            <StatCard icon="studentAnalytics" label="At-Risk Students" value={atRiskStudents.length} colorClass="bg-orange" />
                        </div>
                        
                        {pendingApprovals.length > 0 && (
                            <div className="dashboard-card" style={{ gridColumn: 'span 2' }}>
                                <h3>Pending Approvals</h3>
                                <div>
                                    {pendingApprovals.slice(0, 4).map(u => (
                                        <div key={u.id} className="pending-action-item">
                                            <div className="pending-action-info">
                                                <span className="name">{u.name}</span>
                                                <span className="meta capitalize">{u.role} - {u.dept}</span>
                                            </div>
                                            <button className="btn btn-sm btn-secondary" onClick={() => setView('userManagement')}>View</button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        {activeAlerts.length > 0 && (
                             <div className="dashboard-card" style={{ gridColumn: 'span 2' }}>
                                 <h3>Active Security Alerts</h3>
                                 <div>
                                    {activeAlerts.slice(0, 3).map(alert => (
                                        <div key={alert.id} className="pending-action-item">
                                             <div className="pending-action-info">
                                                <span className="name">{alert.title}</span>
                                                <span className={`severity-badge severity-${alert.severity}`}>{alert.severity}</span>
                                            </div>
                                            <button className="btn btn-sm btn-secondary" onClick={() => setView('security')}>Investigate</button>
                                        </div>
                                    ))}
                                </div>
                             </div>
                        )}
                    </>
                ) : (
                    <>
                        <div className="stat-grid">
                            <StatCard icon="studentDirectory" label="Average Grade" value={`${performance.avgGrade}%`} colorClass="bg-blue" />
                            <StatCard icon="academicCalendar" label="Attendance" value={`${performance.attendance}%`} colorClass="bg-green" />
                        </div>

                        <div className="dashboard-card" style={{gridColumn: 'span 2'}}>
                            <h3>Today's Schedule ({today})</h3>
                            {userTimetable.length > 0 ? (
                                <div className="schedule-list">
                                    {userTimetable.map((entry, index) => (
                                        <div key={entry.id} className="schedule-item stagger-item" style={{ animationDelay: `${index * 100}ms`}}>
                                            <div className="schedule-time">{settings.timeSlots[entry.timeIndex]}</div>
                                            <div className={`schedule-type-indicator ${entry.type}`}></div>
                                            <div className="schedule-details">
                                                <div className="schedule-subject">{entry.subject}</div>
                                                <div className="schedule-meta">
                                                    <span>{entry.type === 'class' ? entry.faculty : entry.room}</span>
                                                    <span>{entry.room}</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="empty-state">No classes scheduled for today.</div>
                            )}
                        </div>

                        <div className="dashboard-card" style={{gridColumn: 'span 2'}}>
                            <h3>Recent Announcements</h3>
                             {relevantAnnouncements.length > 0 ? (
                                <div className="feed-list">
                                    {relevantAnnouncements.map((ann, index) => (
                                        <div key={ann.id} className="feed-item-card stagger-item" style={{ animationDelay: `${index * 100}ms`}}>
                                            <div className="feed-item-icon"><Icon name="announcements" /></div>
                                            <div>
                                                <div className="feed-item-title">{ann.title}</div>
                                                <div className="feed-item-meta">{ann.author} &bull; {formatRelativeTime(ann.timestamp)}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                 <div className="empty-state">No recent announcements.</div>
                            )}
                        </div>
                    </>
                )}

                 <div className="dashboard-card full-width">
                    <h3>Quick Actions</h3>
                     <div className="quick-actions-grid">
                         <button onClick={() => setView('timetable')} className="quick-action-btn"><Icon name="timetable"/><span>View Full Timetable</span></button>
                         <button onClick={() => setView('announcements')} className="quick-action-btn"><Icon name="announcements"/><span>All Announcements</span></button>
                         <button onClick={() => setView('resources')} className="quick-action-btn"><Icon name="resources"/><span>Study Resources</span></button>
                         <button onClick={() => setView('academicCalendar')} className="quick-action-btn"><Icon name="academicCalendar"/><span>Academic Calendar</span></button>
                     </div>
                </div>
            </div>
        </div>
    );
}

function TimetableView({ user, timetable, settings, setTimetable, addNotification }: { user: User; timetable: TimetableEntry[]; settings: AppSettings; setTimetable: React.Dispatch<React.SetStateAction<TimetableEntry[]>>; addNotification: Function; }) {
    const [filterDept, setFilterDept] = useState(user.dept);
    const [filterYear, setFilterYear] = useState(user.year || 'I');
    const [isEditing, setIsEditing] = useState<TimetableEntry | null>(null);
    const [editingCell, setEditingCell] = useState<{ day: string, timeIndex: number } | null>(null);

    const canEdit = user.role === 'admin' || user.role === 'hod';

    const filteredTimetable = useMemo(() => {
        return timetable.filter(entry => entry.department === filterDept && entry.year === filterYear);
    }, [timetable, filterDept, filterYear]);

    const handleCellClick = (day: string, timeIndex: number) => {
        if (!canEdit) return;
        const existingEntry = filteredTimetable.find(e => e.day === day && e.timeIndex === timeIndex);
        if (existingEntry) {
            setIsEditing(existingEntry);
        } else {
            setEditingCell({ day, timeIndex });
        }
    };

    const handleSave = (formData: TimetableEntry) => {
        if (isEditing) {
            setTimetable(prev => prev.map(e => e.id === isEditing.id ? { ...e, ...formData } : e));
            addNotification('Timetable entry updated successfully.', 'success');
        } else if (editingCell) {
             const newEntry: TimetableEntry = {
                ...formData,
                id: `tt_${Date.now()}`,
                department: filterDept,
                year: filterYear,
                day: editingCell.day,
                timeIndex: editingCell.timeIndex,
            };
            setTimetable(prev => [...prev, newEntry]);
            addNotification('Timetable entry added successfully.', 'success');
        }
        setIsEditing(null);
        setEditingCell(null);
    };
    
     const handleDelete = (id: string) => {
        setTimetable(prev => prev.filter(e => e.id !== id));
        addNotification('Timetable entry deleted successfully.', 'success');
        setIsEditing(null);
        setEditingCell(null);
    };


    return (
        <div className="page-content">
            <div className="view-header">
                <h2>Timetable</h2>
                {canEdit && (
                    <button className="btn btn-primary" onClick={() => addNotification('Select a cell to add an entry.', 'info')}>
                        <Icon name="plus" /> Add Entry
                    </button>
                )}
            </div>
            <div className="timetable-header">
                <div className="timetable-controls">
                     <div className="control-group-inline">
                        <label htmlFor="dept-filter">Department:</label>
                        <select id="dept-filter" className="form-control" value={filterDept} onChange={e => setFilterDept(e.target.value)}>
                            {DEPARTMENTS.slice(0, 10).map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                    </div>
                    <div className="control-group-inline">
                        <label htmlFor="year-filter">Year:</label>
                        <select id="year-filter" className="form-control" value={filterYear} onChange={e => setFilterYear(e.target.value)}>
                            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                    </div>
                </div>
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
                                const isEditable = canEdit;
                                return (
                                    <div 
                                        key={`${day}-${timeIndex}`} 
                                        className={`grid-cell ${entry ? entry.type : 'empty'} ${isEditable ? 'editable' : ''} ${isEditable && !entry ? 'editable-empty' : ''}`}
                                        onClick={() => handleCellClick(day, timeIndex)}
                                        role={isEditable ? 'button' : undefined}
                                        tabIndex={isEditable ? 0 : -1}
                                        aria-label={entry ? `Edit ${entry.subject}` : `Add new entry`}
                                    >
                                        {entry && (
                                            <>
                                                <div className="subject">{entry.subject}</div>
                                                <div className="faculty">{entry.faculty}</div>
                                                <div className="room">{entry.room}</div>
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                        </React.Fragment>
                    ))}
                </div>
            </div>
            {(isEditing || editingCell) && (
                <Modal title={isEditing ? 'Edit Timetable Entry' : 'Add Timetable Entry'} onClose={() => { setIsEditing(null); setEditingCell(null); }}>
                    <EditTimetableForm
                        entry={isEditing}
                        onSave={handleSave}
                        onClose={() => { setIsEditing(null); setEditingCell(null); }}
                        onDelete={handleDelete}
                    />
                </Modal>
            )}
        </div>
    );
}

const EditTimetableForm = ({ entry, onSave, onClose, onDelete }: { entry: TimetableEntry | null, onSave: Function, onClose: Function, onDelete: (id: string) => void }) => {
    const [formData, setFormData] = useState({
        subject: entry?.subject || '',
        faculty: entry?.faculty || '',
        room: entry?.room || '',
        type: entry?.type || 'class',
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(formData);
    };

    return (
        <form onSubmit={handleSubmit}>
            <div className="modal-body">
                <div className="control-group">
                    <label htmlFor="subject">Subject</label>
                    <input id="subject" name="subject" type="text" className="form-control" value={formData.subject} onChange={handleChange} required />
                </div>
                 <div className="form-grid">
                    <div className="control-group">
                        <label htmlFor="faculty">Faculty</label>
                        <input id="faculty" name="faculty" type="text" className="form-control" value={formData.faculty} onChange={handleChange} />
                    </div>
                    <div className="control-group">
                        <label htmlFor="room">Room No.</label>
                        <input id="room" name="room" type="text" className="form-control" value={formData.room} onChange={handleChange} />
                    </div>
                </div>
                <div className="control-group">
                    <label htmlFor="type">Type</label>
                    <select id="type" name="type" className="form-control" value={formData.type} onChange={handleChange}>
                        <option value="class">Class</option>
                        <option value="lab">Lab</option>
                        <option value="break">Break</option>
                        <option value="common">Common Hour</option>
                    </select>
                </div>
            </div>
            <div className="modal-footer">
                 <div>
                    {entry && <button type="button" className="btn btn-danger-outline" onClick={() => onDelete(entry.id)}>Delete</button>}
                </div>
                <div>
                    <button type="button" className="btn btn-secondary" onClick={() => onClose()}>Cancel</button>
                    <button type="submit" className="btn btn-primary">Save Changes</button>
                </div>
            </div>
        </form>
    );
};

function AnnouncementsView({ user, announcements, setAnnouncements, addNotification }: { user: User; announcements: Announcement[]; setAnnouncements: React.Dispatch<React.SetStateAction<Announcement[]>>; addNotification: Function; }) {
    const [showModal, setShowModal] = useState(false);
    const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);

    const canCreate = ['admin', 'hod', 'principal', 'faculty'].includes(user.role);

    const handleSave = (announcement: Announcement) => {
        if (editingAnnouncement) {
            setAnnouncements(prev => prev.map(a => a.id === editingAnnouncement.id ? announcement : a));
            addNotification("Announcement updated successfully", "success");
        } else {
            setAnnouncements(prev => [announcement, ...prev]);
            addNotification("Announcement published successfully", "success");
        }
        setShowModal(false);
        setEditingAnnouncement(null);
    };

    const handleDelete = (id: string) => {
        setAnnouncements(prev => prev.filter(a => a.id !== id));
        addNotification("Announcement deleted", "success");
    };

    const handleEdit = (announcement: Announcement) => {
        setEditingAnnouncement(announcement);
        setShowModal(true);
    };

    const handleAddNew = () => {
        setEditingAnnouncement(null);
        setShowModal(true);
    };

    return (
        <div className="page-content">
            <div className="view-header">
                <h2>Announcements</h2>
                {canCreate && (
                    <button className="btn btn-primary" onClick={handleAddNew}>
                        <Icon name="plus" /> New Announcement
                    </button>
                )}
            </div>
            <div className="announcement-list">
                {announcements.map(ann => (
                    <div key={ann.id} className="announcement-card">
                        {(user.role === 'admin' || user.id === ann.authorId) && (
                            <div className="card-actions-top">
                                <button className="btn-icon" onClick={() => handleEdit(ann)} aria-label="Edit announcement"><Icon name="edit" /></button>
                                <button className="btn-icon icon-danger" onClick={() => handleDelete(ann.id)} aria-label="Delete announcement"><Icon name="delete" /></button>
                            </div>
                        )}
                        <h3>{ann.title}</h3>
                        <div className="announcement-meta">
                            <span>By {ann.author}</span>
                            <span>{formatRelativeTime(ann.timestamp)}</span>
                        </div>
                        <div className="announcement-content" dangerouslySetInnerHTML={{ __html: marked(ann.content) }}></div>
                    </div>
                ))}
            </div>
            {showModal && (
                <Modal title={editingAnnouncement ? "Edit Announcement" : "New Announcement"} onClose={() => setShowModal(false)} size="large">
                    <AnnouncementForm
                        user={user}
                        announcement={editingAnnouncement}
                        onSave={handleSave}
                        onClose={() => setShowModal(false)}
                    />
                </Modal>
            )}
        </div>
    );
}

const AnnouncementForm = ({ user, announcement, onSave, onClose }: { user: User; announcement: Announcement | null; onSave: Function; onClose: Function; }) => {
    const [title, setTitle] = useState(announcement?.title || '');
    const [content, setContent] = useState(announcement?.content || '');
    const [targetRole, setTargetRole] = useState<Announcement['targetRole']>(announcement?.targetRole || 'all');
    const [targetDept, setTargetDept] = useState<Announcement['targetDept']>(announcement?.targetDept || 'all');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const newAnnouncement: Announcement = {
            id: announcement?.id || `ann_${Date.now()}`,
            title,
            content,
            author: user.name,
            authorId: user.id,
            timestamp: Date.now(),
            targetRole: targetRole as Announcement['targetRole'],
            targetDept: targetDept as Announcement['targetDept'],
        };
        onSave(newAnnouncement);
    };

    return (
        <form onSubmit={handleSubmit}>
            <div className="modal-body">
                <div className="control-group">
                    <label htmlFor="ann-title">Title</label>
                    <input id="ann-title" type="text" className="form-control" value={title} onChange={e => setTitle(e.target.value)} required />
                </div>
                <div className="control-group">
                    <label htmlFor="ann-content">Content (Markdown supported)</label>
                    <textarea id="ann-content" className="form-control" rows={8} value={content} onChange={e => setContent(e.target.value)} required></textarea>
                </div>
                <div className="form-grid">
                    <div className="control-group">
                        <label htmlFor="ann-role">Target Audience</label>
                        <select id="ann-role" className="form-control" value={targetRole} onChange={e => setTargetRole(e.target.value as Announcement['targetRole'])}>
                            <option value="all">All Roles</option>
                            <option value="student">Students Only</option>
                            <option value="faculty">Faculty Only</option>
                        </select>
                    </div>
                    <div className="control-group">
                        <label htmlFor="ann-dept">Target Department</label>
                        <select id="ann-dept" className="form-control" value={targetDept} onChange={e => setTargetDept(e.target.value as Announcement['targetDept'])}>
                            <option value="all">All Departments</option>
                            {DEPARTMENTS.slice(0, 10).map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                    </div>
                </div>
            </div>
            <div className="modal-footer">
                <div></div>
                <div>
                    <button type="button" className="btn btn-secondary" onClick={() => onClose()}>Cancel</button>
                    <button type="submit" className="btn btn-primary">Publish</button>
                </div>
            </div>
        </form>
    );
}

function UserManagementView({ users, setUsers, addNotification }: { users: User[]; setUsers: React.Dispatch<React.SetStateAction<User[]>>; addNotification: Function; }) {
    const [filterRole, setFilterRole] = useState('all');
    const [filterStatus, setFilterStatus] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [isGenerating, setIsGenerating] = useState<string | null>(null);

    const filteredUsers = useMemo(() => {
        return users.filter(user =>
            (filterRole === 'all' || user.role === filterRole) &&
            (filterStatus === 'all' || user.status === filterStatus) &&
            (user.name.toLowerCase().includes(searchTerm.toLowerCase()) || user.id.toLowerCase().includes(searchTerm.toLowerCase()))
        );
    }, [users, filterRole, filterStatus, searchTerm]);

    const handleUserAction = (id: string, action: 'approve' | 'reject' | 'lock' | 'unlock') => {
        setUsers(prev => prev.map(user => {
            if (user.id === id) {
                switch (action) {
                    case 'approve': return { ...user, status: 'active' };
                    case 'reject': return { ...user, status: 'rejected' };
                    case 'lock': return { ...user, isLocked: true, status: 'locked' };
                    case 'unlock': return { ...user, isLocked: false, status: 'active' };
                    default: return user;
                }
            }
            return user;
        }));
        addNotification(`User ${action}d successfully.`, 'success');
    };

    const generateAiSummary = async (user: User) => {
        if (!ai) {
            addNotification('AI features are disabled.', 'error');
            return;
        }
        setIsGenerating(user.id);
        try {
            const prompt = `Generate a concise administrative summary for the following student/faculty profile. Focus on academic standing, potential, and any noteworthy points. Be professional and brief.

            Name: ${user.name}
            Role: ${user.role}
            Department: ${user.dept}
            ${user.year ? `Year: ${user.year}` : ''}
            Status: ${user.status}
            ${user.grades ? `Grades: ${JSON.stringify(user.grades)}` : ''}
            ${user.attendance ? `Attendance: ${user.attendance.present}/${user.attendance.total} sessions` : ''}
            
            Format the output as a JSON object with three keys: "profile", "standing", and "note".
            `;
            const result = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: { responseMimeType: 'application/json' }
            });
            const summary = JSON.parse(result.text);
            setUsers(prev => prev.map(u => u.id === user.id ? { ...u, aiSummary: summary } : u));
            addNotification(`AI summary generated for ${user.name}.`, 'success');
        } catch (error) {
            console.error(error);
            addNotification('Failed to generate AI summary.', 'error');
        } finally {
            setIsGenerating(null);
        }
    };

    return (
        <div className="page-content">
            <div className="view-header">
                <h2>User Management</h2>
            </div>
            <div className="table-filters">
                <div className="control-group search-filter">
                    <Icon name="search" />
                    <input type="text" className="form-control" placeholder="Search by name or ID..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                </div>
                <div className="control-group">
                    <select className="form-control" value={filterRole} onChange={e => setFilterRole(e.target.value)}>
                        <option value="all">All Roles</option>
                        {ROLES.map(r => <option key={r} value={r} className="capitalize">{r}</option>)}
                    </select>
                </div>
                <div className="control-group">
                    <select className="form-control" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                        <option value="all">All Statuses</option>
                        <option value="active">Active</option>
                        <option value="pending_approval">Pending</option>
                        <option value="rejected">Rejected</option>
                        <option value="locked">Locked</option>
                    </select>
                </div>
            </div>

            <div className="table-wrapper">
                <table className="entry-list-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Role</th>
                            <th>Department</th>
                            <th>Status</th>
                            <th>AI Summary</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredUsers.map((user, index) => (
                            <tr key={user.id} className="stagger-item" style={{ animationDelay: `${index * 50}ms` }}>
                                <td>
                                    <div className="user-name-cell">
                                        <span>{user.name}</span>
                                        <span className="user-id-subtext">{user.id}</span>
                                    </div>
                                </td>
                                <td className="capitalize">{user.role}</td>
                                <td>{user.dept}</td>
                                <td><span className={`status-badge status-${user.status}`}>{user.status.replace('_', ' ')}</span></td>
                                <td style={{textAlign: 'center'}}>
                                    {isGenerating === user.id ? (
                                        <div className="spinner-container"><div className="spinner"></div></div>
                                    ) : user.aiSummary ? (
                                        <button className="btn-icon" onClick={() => setSelectedUser(user)} aria-label="View AI Summary">
                                            <Icon name="eye"/>
                                        </button>
                                    ) : (
                                        <button 
                                            className="btn-icon btn-ai-icon" 
                                            onClick={() => generateAiSummary(user)} 
                                            disabled={!isAiEnabled || !!isGenerating}
                                            aria-label="Generate AI Summary">
                                            <Icon name="sparkles"/>
                                        </button>
                                    )}
                                </td>
                                <td>
                                    {user.status === 'pending_approval' ? (
                                        <div className="flex gap-2">
                                            <button className="btn btn-sm btn-success" onClick={() => handleUserAction(user.id, 'approve')}>Approve</button>
                                            <button className="btn btn-sm btn-danger-outline" onClick={() => handleUserAction(user.id, 'reject')}>Reject</button>
                                        </div>
                                    ) : (
                                        <div className="flex gap-2">
                                            {user.isLocked ? (
                                                <button className="btn btn-sm btn-secondary" onClick={() => handleUserAction(user.id, 'unlock')}>Unlock</button>
                                            ) : (
                                                <button className="btn btn-sm btn-danger-outline" onClick={() => handleUserAction(user.id, 'lock')}>Lock</button>
                                            )}
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
             {selectedUser && selectedUser.aiSummary && (
                <Modal title={`AI Summary for ${selectedUser.name}`} onClose={() => setSelectedUser(null)}>
                    <div className="modal-body">
                         <div className="analysis-result-section">
                             <h4>Profile Overview</h4>
                             <p>{selectedUser.aiSummary.profile}</p>
                         </div>
                          <div className="analysis-result-section">
                             <h4>Academic/Professional Standing</h4>
                             <p>{selectedUser.aiSummary.standing}</p>
                         </div>
                          <div className="analysis-result-section">
                             <h4>Administrative Note</h4>
                             <p>{selectedUser.aiSummary.note}</p>
                         </div>
                    </div>
                     <div className="modal-footer">
                         <div></div>
                         <button className="btn btn-primary" onClick={() => setSelectedUser(null)}>Close</button>
                    </div>
                </Modal>
            )}
        </div>
    );
}

function StudentDirectoryView({ users }: { users: User[] }) {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedStudent, setSelectedStudent] = useState<User | null>(null);

    const students = useMemo(() =>
        users.filter(u => u.role === 'student' && (u.name.toLowerCase().includes(searchTerm.toLowerCase()) || u.dept.toLowerCase().includes(searchTerm.toLowerCase())))
    , [users, searchTerm]);

    return (
        <div className="page-content">
            <div className="view-header">
                <h2>Student Directory</h2>
            </div>
            <div className="table-filters">
                <div className="control-group search-filter">
                    <Icon name="search" />
                    <input type="text" className="form-control" placeholder="Search by name or department..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                </div>
            </div>
            <div className="student-directory-grid">
                {students.map(student => (
                    <div key={student.id} className="student-card" onClick={() => setSelectedStudent(student)}>
                        <div className="student-card-info">
                            <h4>{student.name}</h4>
                            <p>{student.dept} - Year {student.year}</p>
                        </div>
                         <div className={`status-badge-dot status-${student.status}`}></div>
                    </div>
                ))}
            </div>
            {selectedStudent && (
                 <Modal title={selectedStudent.name} onClose={() => setSelectedStudent(null)} size="large">
                    <div className="modal-body">
                        <div className="student-profile-grid">
                            <div className="student-profile-details">
                                <h3>Student Details</h3>
                                <p><strong>Department:</strong> {selectedStudent.dept}</p>
                                <p><strong>Year:</strong> {selectedStudent.year}</p>
                                <p><strong>Status:</strong> <span className={`status-badge status-${selectedStudent.status}`}>{selectedStudent.status}</span></p>
                                {selectedStudent.attendance && (
                                     <p><strong>Attendance:</strong> {selectedStudent.attendance.present} / {selectedStudent.attendance.total} days ({((selectedStudent.attendance.present / selectedStudent.attendance.total) * 100).toFixed(1)}%)</p>
                                )}
                            </div>
                             <div className="student-profile-analytics">
                                 {selectedStudent.grades && selectedStudent.grades.length > 0 && (
                                     <BarChart data={selectedStudent.grades} title="Academic Performance"/>
                                 )}
                            </div>
                        </div>
                    </div>
                 </Modal>
            )}
        </div>
    );
}

function AcademicCalendarView({ events, setEvents, user }: { events: CalendarEvent[], setEvents: React.Dispatch<React.SetStateAction<CalendarEvent[]>>, user: User }) {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [showModal, setShowModal] = useState(false);

    const canEdit = ['admin', 'principal'].includes(user.role);

    const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
    const startDay = startOfMonth.getDay(); // 0 for Sunday, 1 for Monday...
    const daysInMonth = endOfMonth.getDate();

    const calendarDays = [];
    for (let i = 0; i < startDay; i++) {
        calendarDays.push(<div key={`empty-start-${i}`} className="calendar-day empty"></div>);
    }
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayEvents = events.filter(e => e.date === dateStr);
        const isToday = new Date().toISOString().split('T')[0] === dateStr;

        calendarDays.push(
            <div key={day} className={`calendar-day ${isToday ? 'today' : ''}`}>
                <div className="day-number">{day}</div>
                <div className="day-events">
                    {dayEvents.map(event => (
                        <div key={event.id} className={`calendar-event event-${event.type}`}>{event.title}</div>
                    ))}
                </div>
            </div>
        );
    }

    const handlePrevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    const handleNextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));

    const handleSave = (eventData: Omit<CalendarEvent, 'id'>) => {
        const newEvent: CalendarEvent = { id: `evt_${Date.now()}`, ...eventData };
        setEvents(prev => [...prev, newEvent].sort((a,b) => a.date.localeCompare(b.date)));
        setShowModal(false);
    }

    return (
        <div className="page-content">
            <div className="view-header">
                <h2>Academic Calendar</h2>
                {canEdit && <button className="btn btn-primary" onClick={() => setShowModal(true)}><Icon name="plus"/> Add Event</button>}
            </div>
            <div className="calendar-container">
                <div className="calendar-header">
                    <button onClick={handlePrevMonth} className="btn-icon"><Icon name="left"/></button>
                    <h3>{currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}</h3>
                    <button onClick={handleNextMonth} className="btn-icon"><Icon name="right"/></button>
                </div>
                <div className="calendar-grid">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <div key={day} className="calendar-weekday">{day}</div>)}
                    {calendarDays}
                </div>
            </div>
            {showModal && (
                 <Modal title="Add Calendar Event" onClose={() => setShowModal(false)}>
                    <EventForm onSave={handleSave} onClose={() => setShowModal(false)}/>
                 </Modal>
            )}
        </div>
    );
}

const EventForm = ({ onSave, onClose }: { onSave: (event: Omit<CalendarEvent, 'id'>) => void; onClose: () => void; }) => {
    const [title, setTitle] = useState('');
    const [date, setDate] = useState('');
    const [type, setType] = useState<'exam' | 'holiday' | 'event' | 'deadline'>('event');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({ title, date, type });
    };

    return (
         <form onSubmit={handleSubmit}>
            <div className="modal-body">
                <div className="control-group">
                    <label htmlFor="evt-title">Event Title</label>
                    <input id="evt-title" type="text" className="form-control" value={title} onChange={e => setTitle(e.target.value)} required />
                </div>
                <div className="form-grid">
                    <div className="control-group">
                        <label htmlFor="evt-date">Date</label>
                        <input id="evt-date" type="date" className="form-control" value={date} onChange={e => setDate(e.target.value)} required />
                    </div>
                    <div className="control-group">
                        <label htmlFor="evt-type">Type</label>
                        <select id="evt-type" className="form-control" value={type} onChange={e => setType(e.target.value as any)}>
                            <option value="event">Event</option>
                            <option value="exam">Exam</option>
                            <option value="deadline">Deadline</option>
                            <option value="holiday">Holiday</option>
                        </select>
                    </div>
                </div>
            </div>
            <div className="modal-footer">
                <div></div>
                <div>
                    <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
                    <button type="submit" className="btn btn-primary">Add Event</button>
                </div>
            </div>
        </form>
    );
}

function CareerCounselorView({ user, setUser, addNotification }: { user: User; setUser: (user: User) => void; addNotification: Function; }) {
    const [profile, setProfile] = useState<CareerProfile>(user.careerProfile || { interests: [], skills: [], careerGoals: '' });
    const [isGenerating, setIsGenerating] = useState(false);

    const handleProfileChange = (field: keyof CareerProfile, value: string) => {
        setProfile(prev => ({
            ...prev,
            [field]: field === 'interests' || field === 'skills' ? value.split(',').map(s => s.trim()) : value
        }));
    };
    
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        // Save profile to user data
        const updatedUser = { ...user, careerProfile: profile };
        setUser(updatedUser);
        generateReport(updatedUser);
    };

    const generateReport = async (currentUser: User) => {
        if (!ai || !currentUser.careerProfile) {
            addNotification('AI features are disabled or profile is incomplete.', 'error');
            return;
        }
        setIsGenerating(true);
        try {
            const prompt = `
                Based on the following student profile, act as an expert career counselor and generate a career report.
                - Student Name: ${currentUser.name}
                - Department: ${currentUser.dept}, Year: ${currentUser.year}
                - Interests: ${currentUser.careerProfile.interests.join(', ')}
                - Current Skills: ${currentUser.careerProfile.skills.join(', ')}
                - Career Goals: ${currentUser.careerProfile.careerGoals}
                - Academic Performance: ${JSON.stringify(currentUser.grades)}

                Generate a JSON object with the following structure:
                {
                  "suggestedPaths": [{"title": "string", "description": "string", "relevance": "string (explain why it's a good fit)"}],
                  "skillsToDevelop": ["string"],
                  "recommendedCourses": [{"title": "string", "platform": "string (e.g., Coursera, Udemy)", "url": "string"}]
                }
                Provide at least 3 career paths, 5 skills, and 3 course recommendations.
            `;
             const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: { responseMimeType: "application/json" }
            });
            const reportData = JSON.parse(response.text);
            const newReport: CareerReport = { ...reportData, timestamp: Date.now() };
            setUser({ ...currentUser, careerReport: newReport });
            addNotification("Career report generated successfully!", "success");

        } catch (error) {
            console.error(error);
            addNotification("Failed to generate career report.", "error");
        } finally {
            setIsGenerating(false);
        }
    };
    
    return (
        <div className="page-content">
            <div className="view-header">
                <h2>AI Career Counselor</h2>
            </div>
            <div className="career-counselor-layout">
                <div className="counselor-form-card">
                    <h3>Your Career Profile</h3>
                    <p>Tell us about your goals to get a personalized report.</p>
                    <form onSubmit={handleSubmit}>
                        <div className="control-group">
                            <label htmlFor="interests">Interests (comma-separated)</label>
                            <input id="interests" type="text" className="form-control" value={profile.interests.join(', ')} onChange={e => handleProfileChange('interests', e.target.value)} />
                        </div>
                        <div className="control-group">
                            <label htmlFor="skills">Skills (comma-separated)</label>
                            <input id="skills" type="text" className="form-control" value={profile.skills.join(', ')} onChange={e => handleProfileChange('skills', e.target.value)} />
                        </div>
                        <div className="control-group">
                            <label htmlFor="careerGoals">Career Goals</label>
                            <textarea id="careerGoals" className="form-control" rows={3} value={profile.careerGoals} onChange={e => handleProfileChange('careerGoals', e.target.value)}></textarea>
                        </div>
                        <button type="submit" className="btn btn-ai w-full" disabled={isGenerating}>
                            {isGenerating ? <><div className="spinner"></div> Generating Report...</> : <><Icon name="sparkles" /> Generate AI Career Report</>}
                        </button>
                    </form>
                </div>
                <div className="counselor-report-card">
                    <h3>Your Report</h3>
                    {user.careerReport ? (
                        <div className="career-report">
                            <p className="report-timestamp">Generated: {formatRelativeTime(user.careerReport.timestamp)}</p>
                            
                            <h4>Suggested Career Paths</h4>
                            {user.careerReport.suggestedPaths.map((path, i) => (
                                <div key={i} className="report-section">
                                    <h5>{path.title}</h5>
                                    <p>{path.description}</p>
                                    <p><strong>Relevance:</strong> {path.relevance}</p>
                                </div>
                            ))}

                            <h4>Skills to Develop</h4>
                            <ul className="skills-list">
                                {user.careerReport.skillsToDevelop.map((skill, i) => <li key={i}>{skill}</li>)}
                            </ul>
                            
                            <h4>Recommended Courses</h4>
                             {user.careerReport.recommendedCourses.map((course, i) => (
                                <div key={i} className="course-recommendation">
                                    <a href={course.url} target="_blank" rel="noopener noreferrer">{course.title}</a> on {course.platform}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="empty-state">
                            <p>Complete your profile and generate a report to see your career insights.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function ResourcesView({ resources, user }: { resources: Resource[], user: User }) {
    const [searchTerm, setSearchTerm] = useState('');
    const resourceTypes: Resource['type'][] = ['book', 'notes', 'project', 'lab', 'other'];
    const canUpload = ['faculty', 'hod', 'admin'].includes(user.role);

    const filteredResources = useMemo(() => {
        return resources.filter(res =>
            res.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            res.subject.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [resources, searchTerm]);

    return (
        <div className="page-content">
            <div className="view-header">
                <h2>Study Resources</h2>
                {canUpload && <button className="btn btn-primary"><Icon name="upload"/> Upload New</button>}
            </div>
            <div className="table-filters">
                 <div className="control-group search-filter">
                    <Icon name="search" />
                    <input type="text" className="form-control" placeholder="Search resources..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                </div>
            </div>
            <div className="resource-grid">
                {filteredResources.map(res => (
                    <div key={res.id} className="resource-card">
                        <div className="resource-card-header">
                            <div className={`resource-icon-container resource-icon-bg-${res.type}`}>
                                <Icon name={res.type} />
                            </div>
                            <button className="btn-icon"><Icon name="download"/></button>
                        </div>
                        <div className="resource-card-body">
                            <h4>{res.name}</h4>
                            <p>{res.subject}</p>
                        </div>
                        <div className="resource-card-footer">
                             <span>{res.uploaderName}</span>
                             <span>{formatRelativeTime(res.timestamp)}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function CourseFilesView({ courseFiles, setCourseFiles, user }: { courseFiles: CourseFile[], setCourseFiles: React.Dispatch<React.SetStateAction<CourseFile[]>>, user: User }) {
    const canReview = ['hod', 'principal'].includes(user.role);
    const canUpload = user.role === 'faculty';

    const handleStatusChange = (id: string, status: CourseFile['status']) => {
        setCourseFiles(prev => prev.map(cf => cf.id === id ? { ...cf, status } : cf));
    }
    
    return (
        <div className="page-content">
            <div className="view-header">
                <h2>Course Files</h2>
                {canUpload && <button className="btn btn-primary"><Icon name="upload"/> Upload Files</button>}
            </div>
            <div className="table-wrapper">
                <table className="entry-list-table">
                    <thead>
                        <tr>
                            <th>Subject</th>
                            <th>Faculty</th>
                            <th>Semester</th>
                            <th>Files</th>
                            <th>Status</th>
                            {canReview && <th>Actions</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {courseFiles.map((cf, index) => (
                            <tr key={cf.id} className="stagger-item" style={{ animationDelay: `${index * 50}ms` }}>
                                <td>{cf.subject}</td>
                                <td>{cf.facultyName}</td>
                                <td>{cf.semester}</td>
                                <td>{cf.files.length} file(s)</td>
                                <td><span className={`status-badge status-${cf.status.replace('_', '-')}`}>{cf.status.replace('_', ' ')}</span></td>
                                {canReview && (
                                    <td>
                                        {cf.status === 'pending_review' && (
                                            <div className="flex gap-2">
                                                <button className="btn btn-sm btn-success" onClick={() => handleStatusChange(cf.id, 'approved')}>Approve</button>
                                                <button className="btn btn-sm btn-danger-outline" onClick={() => handleStatusChange(cf.id, 'needs_revision')}>Reject</button>
                                            </div>
                                        )}
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function StudentAnalyticsView({ users }: { users: User[] }) {
    const students = users.filter(u => u.role === 'student');
    const overallAttendance = useMemo(() => {
        const total = students.reduce((acc, s) => acc + (s.attendance?.total || 0), 0);
        const present = students.reduce((acc, s) => acc + (s.attendance?.present || 0), 0);
        return total > 0 ? (present / total) * 100 : 0;
    }, [students]);

    const averageGrade = useMemo(() => {
        const allGrades = students.flatMap(s => s.grades?.map(g => g.score) || []);
        return allGrades.length > 0 ? allGrades.reduce((a, b) => a + b, 0) / allGrades.length : 0;
    }, [students]);

    const atRiskStudents = students.filter(s => (s.attendance && (s.attendance.present / s.attendance.total) < 0.75) || (s.grades && s.grades.some(g => g.score < 50)));

    return (
        <div className="page-content">
            <div className="view-header">
                <h2>Student Analytics</h2>
            </div>
            <div className="analytics-grid">
                <div className="analytics-card">
                    <h4>Overall Attendance</h4>
                    <p className="stat-large">{overallAttendance.toFixed(1)}%</p>
                </div>
                <div className="analytics-card">
                    <h4>Average Grade</h4>
                    <p className="stat-large">{averageGrade.toFixed(1)}%</p>
                </div>
                <div className="analytics-card">
                    <h4>Students At-Risk</h4>
                    <p className="stat-large">{atRiskStudents.length}</p>
                </div>
                <div className="analytics-card full-span">
                     {students.find(s => s.grades)?.grades && <BarChart data={students.find(s => s.grades)!.grades!} title="Sample Student Performance" />}
                </div>
            </div>
        </div>
    );
}

function SecurityView({ alerts, setAlerts }: { alerts: SecurityAlert[], setAlerts: React.Dispatch<React.SetStateAction<SecurityAlert[]>> }) {
    
    const handleResolve = (id: string) => {
        setAlerts(prev => prev.map(a => a.id === id ? { ...a, isResolved: true } : a));
    }

    return (
        <div className="page-content">
            <div className="view-header">
                <h2>Security Center</h2>
            </div>
            <div className="table-wrapper">
                <table className="entry-list-table">
                    <thead>
                        <tr>
                            <th>Alert</th>
                            <th>Severity</th>
                            <th>Timestamp</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {alerts.map((alert, index) => (
                            <tr key={alert.id} className="stagger-item" style={{ animationDelay: `${index * 50}ms` }}>
                                <td>
                                    <div className="user-name-cell">
                                        <span>{alert.title}</span>
                                        <span className="user-id-subtext">{alert.description}</span>
                                    </div>
                                </td>
                                <td><span className={`severity-badge severity-${alert.severity}`}>{alert.severity}</span></td>
                                <td>{formatRelativeTime(alert.timestamp)}</td>
                                <td>{alert.isResolved ? 'Resolved' : 'Active'}</td>
                                <td>
                                    {!alert.isResolved && <button className="btn btn-sm btn-secondary" onClick={() => handleResolve(alert.id)}>Mark as Resolved</button>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function SettingsView({ settings, setSettings }: { settings: AppSettings, setSettings: React.Dispatch<React.SetStateAction<AppSettings>> }) {
    
    const handleThemeChange = (theme: 'light' | 'dark') => {
        setSettings(prev => ({...prev, theme}));
    }

    const handleAccentChange = (themeName: string) => {
        setSettings(prev => ({...prev, activeTheme: themeName}));
    }

    return (
        <div className="page-content">
             <div className="view-header">
                <h2>Settings</h2>
            </div>
            <div className="settings-card">
                <h3>Appearance</h3>
                <div className="control-group">
                    <label>Theme</label>
                    <div className="theme-toggle">
                        <button className={settings.theme === 'light' ? 'active' : ''} onClick={() => handleThemeChange('light')}>Light</button>
                        <button className={settings.theme === 'dark' ? 'active' : ''} onClick={() => handleThemeChange('dark')}>Dark</button>
                    </div>
                </div>
                <div className="control-group">
                    <label>Accent Color</label>
                    <div className="accent-picker">
                        {THEMES.map(theme => (
                            <button 
                                key={theme.name} 
                                className={`accent-color-dot ${settings.activeTheme === theme.name ? 'active' : ''}`}
                                style={{ backgroundColor: theme.colors['--accent-primary'] }}
                                onClick={() => handleAccentChange(theme.name)}
                                aria-label={`Select ${theme.name} theme`}
                            />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

const App = () => {
    const [users, setUsers] = useLocalStorage<User[]>('app_users', initialUsers);
    const [currentUser, setCurrentUser] = useLocalStorage<User | null>('app_currentUser', null);
    const [timetable, setTimetable] = useLocalStorage<TimetableEntry[]>('app_timetable', initialTimetable);
    const [announcements, setAnnouncements] = useLocalStorage<Announcement[]>('app_announcements', initialAnnouncements);
    const [resources, setResources] = useLocalStorage<Resource[]>('app_resources', initialResources);
    const [courseFiles, setCourseFiles] = useLocalStorage<CourseFile[]>('app_courseFiles', initialCourseFiles);
    const [calendarEvents, setCalendarEvents] = useLocalStorage<CalendarEvent[]>('app_calendarEvents', initialCalendarEvents);
    const [securityAlerts, setSecurityAlerts] = useLocalStorage<SecurityAlert[]>('app_securityAlerts', initialSecurityAlerts);
    const [settings, setSettings] = useLocalStorage<AppSettings>('app_settings', initialAppSettings);
    
    const { notifications, toastQueue, addNotification, markAllAsRead, clearNotifications, unreadCount, removeNotification } = useAppNotifications();

    const [view, setView] = useState<AppView>('dashboard');
    const [isSidebarOpen, setSidebarOpen] = useState(false);

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', settings.theme);
        const activeTheme = THEMES.find(t => t.name === settings.activeTheme) || THEMES[0];
        for (const [key, value] of Object.entries(activeTheme.colors)) {
            document.documentElement.style.setProperty(key, value);
        }
    }, [settings.theme, settings.activeTheme]);

    const handleLogin = (userId: string) => {
        const user = users.find(u => u.id === userId);
        if (user) {
            setCurrentUser(user);
            setView('dashboard');
        }
    };

    const handleLogout = () => {
        setCurrentUser(null);
        setView('auth');
    };

    const handleRegister = (newUser: User) => {
        setUsers(prev => [...prev, newUser]);
    };
    
    const handleSetCurrentUser = (updatedUser: User) => {
        setCurrentUser(updatedUser);
        setUsers(prev => prev.map(u => u.id === updatedUser.id ? updatedUser : u));
    };


    const NavLink = ({ currentView, targetView, label, icon, action }: { currentView: AppView, targetView: AppView, label: string, icon: string, action?: () => void }) => (
        <li>
            <button className={`nav-link ${currentView === targetView ? 'active' : ''}`} onClick={() => { setView(targetView); if (action) action(); setSidebarOpen(false); }}>
                <Icon name={icon} />
                <span>{label}</span>
            </button>
        </li>
    );

    const availableViews: { [key in UserRole]?: AppView[] } = {
        student: ['dashboard', 'timetable', 'announcements', 'resources', 'academicCalendar', 'careerCounselor'],
        faculty: ['dashboard', 'timetable', 'announcements', 'resources', 'courseFiles', 'studentDirectory'],
        hod: ['dashboard', 'timetable', 'announcements', 'resources', 'courseFiles', 'studentDirectory', 'userManagement', 'studentAnalytics'],
        admin: ['dashboard', 'timetable', 'userManagement', 'security', 'settings', 'announcements', 'resources', 'academicCalendar'],
        principal: ['dashboard', 'timetable', 'announcements', 'resources', 'courseFiles', 'studentDirectory', 'userManagement', 'studentAnalytics', 'security'],
        creator: ['dashboard', 'timetable', 'announcements', 'resources', 'academicCalendar', 'careerCounselor','userManagement', 'security', 'settings','studentDirectory','courseFiles', 'studentAnalytics'],
    };
    
    const userViews = currentUser ? (availableViews[currentUser.role] || availableViews['student'])! : [];

    if (!currentUser) {
        return (
            <>
                <ToastContainer toasts={toastQueue} removeToast={removeNotification} />
                <AuthView onLogin={handleLogin} onRegister={handleRegister} addNotification={addNotification} />
            </>
        );
    }

    const renderView = () => {
        switch (view) {
            case 'dashboard':
                return <DashboardView user={currentUser} announcements={announcements} timetable={timetable} settings={settings} users={users} securityAlerts={securityAlerts} setView={setView} />;
            case 'timetable':
                return <TimetableView user={currentUser} timetable={timetable} settings={settings} setTimetable={setTimetable} addNotification={addNotification} />;
            case 'announcements':
                return <AnnouncementsView user={currentUser} announcements={announcements} setAnnouncements={setAnnouncements} addNotification={addNotification} />;
             case 'userManagement':
                return <UserManagementView users={users} setUsers={setUsers} addNotification={addNotification} />;
            case 'studentDirectory':
                return <StudentDirectoryView users={users} />;
            case 'academicCalendar':
                return <AcademicCalendarView events={calendarEvents} setEvents={setCalendarEvents} user={currentUser} />;
             case 'careerCounselor':
                return <CareerCounselorView user={currentUser} setUser={handleSetCurrentUser} addNotification={addNotification} />;
            case 'resources':
                return <ResourcesView resources={resources} user={currentUser} />;
            case 'courseFiles':
                return <CourseFilesView courseFiles={courseFiles} setCourseFiles={setCourseFiles} user={currentUser} />;
            case 'studentAnalytics':
                return <StudentAnalyticsView users={users} />;
            case 'security':
                return <SecurityView alerts={securityAlerts} setAlerts={setSecurityAlerts} />;
            case 'settings':
                return <SettingsView settings={settings} setSettings={setSettings} />;
            default:
                setView('dashboard'); // Fallback to dashboard for any unknown view
                return <DashboardView user={currentUser} announcements={announcements} timetable={timetable} settings={settings} users={users} securityAlerts={securityAlerts} setView={setView} />;
        }
    };
    
    const viewTitles: { [key in AppView]: string } = {
        dashboard: 'Dashboard',
        timetable: 'Timetable',
        announcements: 'Announcements',
        resources: 'Resources',
        courseFiles: 'Course Files',
        studentDirectory: 'Student Directory',
        studentAnalytics: 'Student Analytics',
        userManagement: 'User Management',
        security: 'Security Center',
        academicCalendar: 'Academic Calendar',
        careerCounselor: 'Career Counselor',
        settings: 'Settings',
        auth: 'Login',
        manage: 'Manage',
        approvals: 'Approvals',
    };

    return (
        <div className="app-container">
             <ToastContainer toasts={toastQueue} removeToast={removeNotification} />
            <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
                 <div className="sidebar-header">
                     <span className="logo"><Icon name="academicCalendar" /></span>
                     <h1>AcademiaAI</h1>
                     <button className="sidebar-close" onClick={() => setSidebarOpen(false)}><Icon name="close"/></button>
                 </div>
                 <nav className="sidebar-nav">
                     <ul>
                         {userViews.includes('dashboard') && <NavLink currentView={view} targetView='dashboard' label='Dashboard' icon='dashboard' />}
                         {userViews.includes('timetable') && <NavLink currentView={view} targetView='timetable' label='Timetable' icon='timetable' />}
                         {userViews.includes('announcements') && <NavLink currentView={view} targetView='announcements' label='Announcements' icon='announcements' />}
                         {userViews.includes('resources') && <NavLink currentView={view} targetView='resources' label='Resources' icon='resources' />}
                         {userViews.includes('courseFiles') && <NavLink currentView={view} targetView='courseFiles' label='Course Files' icon='courseFiles' />}
                         {userViews.includes('studentDirectory') && <NavLink currentView={view} targetView='studentDirectory' label='Student Directory' icon='studentDirectory' />}
                         {userViews.includes('studentAnalytics') && <NavLink currentView={view} targetView='studentAnalytics' label='Analytics' icon='studentAnalytics' />}
                         {userViews.includes('userManagement') && <NavLink currentView={view} targetView='userManagement' label='Users' icon='userManagement' />}
                         {userViews.includes('security') && <NavLink currentView={view} targetView='security' label='Security' icon='security' />}
                         {userViews.includes('academicCalendar') && <NavLink currentView={view} targetView='academicCalendar' label='Calendar' icon='academicCalendar' />}
                         {userViews.includes('careerCounselor') && <NavLink currentView={view} targetView='careerCounselor' label='Career AI' icon='careerCounselor' />}
                     </ul>
                 </nav>
                 <div className="sidebar-footer">
                     <ul>
                         {userViews.includes('settings') && <NavLink currentView={view} targetView='settings' label='Settings' icon='settings' />}
                         <li>
                             <button className="nav-link" onClick={handleLogout}>
                                 <Icon name="logout" />
                                 <span>Logout</span>
                             </button>
                         </li>
                     </ul>
                 </div>
            </aside>
            <main className="main-content">
                <header className="main-header">
                    <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)}><Icon name="menu"/></button>
                    <h2>{viewTitles[view] || 'Dashboard'}</h2>
                     <div className="header-actions">
                        <button className="header-action-btn">
                            <Icon name="bell" />
                             {unreadCount > 0 && <span className="notification-badge">{unreadCount}</span>}
                        </button>
                        <div className="user-profile-menu">
                             <div className="user-info">
                                 <div className="user-name">{currentUser.name}</div>
                                 <div className="user-role">{currentUser.role}</div>
                             </div>
                             <Icon name="chevronDown" />
                        </div>
                     </div>
                </header>
                 <div className="view-container">
                    {renderView()}
                </div>
            </main>
        </div>
    );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);