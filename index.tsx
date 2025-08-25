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
const USER_ROLES: UserRole[] = ['student', 'faculty', 'hod', 'admin', 'class advisor', 'principal', 'creator'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

const MOCK_SETTINGS: AppSettings = {
    timeSlots: ['09:00 - 10:00', '10:00 - 11:00', '11:00 - 11:15', '11:15 - 12:15', '12:15 - 01:15', '01:15 - 02:00', '02:00 - 03:00', '03:00 - 04:00'],
    accentColor: '#3B82F6',
};

const MOCK_USERS: User[] = [
    { id: 'admin', name: 'Admin', role: 'admin', dept: 'System', status: 'active' },
    { id: 'principal', name: 'Dr. Principal', role: 'principal', dept: 'Management', status: 'active' },
    { id: 'hod_cse', name: 'HOD (CSE)', role: 'hod', dept: 'CSE', status: 'active' },
    { id: 'stud001', name: 'Alice', role: 'student', dept: 'CSE', year: 'II', status: 'active', grades: [{ subject: 'Data Structures', score: 85 }], attendance: { present: 78, total: 80 } },
    { id: 'stud002', name: 'Bob', role: 'student', dept: 'ECE', year: 'III', status: 'pending_approval' },
    { id: 'fac001', name: 'Prof. Charlie', role: 'faculty', dept: 'CSE', status: 'active' },
    { id: 'fac002', name: 'Prof. Diana', role: 'faculty', dept: 'ECE', status: 'rejected' },
    { id: 'creator', name: 'App Creator', role: 'creator', dept: 'System', status: 'active' }
];

const MOCK_ANNOUNCEMENTS: Announcement[] = [
    { id: 'ann001', title: 'Mid-term Exams', content: 'Mid-term exams for all departments will commence from next week. Please collect your hall tickets.', author: 'Admin', timestamp: Date.now() - 86400000, targetRole: 'all', targetDept: 'all', reactions: { '👍': ['stud001', 'fac001'] } },
    { id: 'ann002', title: 'Project Submission Deadline', content: 'Final year project submissions are due this Friday. No extensions will be provided.', author: 'HOD (CSE)', timestamp: Date.now() - 172800000, targetRole: 'student', targetDept: 'CSE' }
];

const MOCK_TIMETABLE: TimetableEntry[] = [
    { id: 'tt001', department: 'CSE', year: 'II', day: 'Monday', timeIndex: 0, subject: 'Data Structures', type: 'class', faculty: 'Prof. Charlie', room: 'CS101' },
    { id: 'tt002', department: 'CSE', year: 'II', day: 'Monday', timeIndex: 1, subject: 'Algorithms', type: 'class', faculty: 'Prof. Charlie', room: 'CS101' },
    { id: 'tt003', department: 'CSE', year: 'II', day: 'Monday', timeIndex: 2, subject: 'Break', type: 'break' },
    { id: 'tt004', department: 'CSE', year: 'II', day: 'Tuesday', timeIndex: 3, subject: 'Database Systems', type: 'class', faculty: 'Prof. Eva', room: 'CS102' }
];

// --- Utility Functions & Hooks ---
function usePersistentState<T>(key: string, defaultValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
    const [state, setState] = useState<T>(() => {
        try {
            const storedValue = localStorage.getItem(key);
            return storedValue ? JSON.parse(storedValue) : defaultValue;
        } catch (error) {
            console.error(`Error reading from localStorage for key "${key}":`, error);
            return defaultValue;
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem(key, JSON.stringify(state));
        } catch (error) {
            console.error(`Error writing to localStorage for key "${key}":`, error);
        }
    }, [key, state]);

    return [state, setState];
}

const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
};

// --- App Context ---
interface AIModalContent {
    title: string;
    content: string;
    isLoading: boolean;
}

interface StudyToolContent {
    type: 'summary' | 'studyPlan';
    title: string;
    content: string;
    isLoading: boolean;
}

interface AppContextType {
    currentUser: User | null;
    currentView: AppView;
    theme: 'light' | 'dark';
    settings: AppSettings;
    users: User[];
    announcements: Announcement[];
    timetable: TimetableEntry[];
    isChatOpen: boolean;
    isSidebarOpen: boolean;
    notifications: AppNotification[];
    aiModalContent: AIModalContent | null;
    studyToolContent: StudyToolContent | null;

    login: (id: string, pass: string) => Promise<boolean>;
    logout: () => void;
    signup: (user: Omit<User, 'id' | 'status'>) => Promise<boolean>;
    setCurrentView: React.Dispatch<React.SetStateAction<AppView>>;
    setTheme: React.Dispatch<React.SetStateAction<'light' | 'dark'>>;
    updateUser: (user: User) => void;
    addAnnouncement: (ann: Omit<Announcement, 'id' | 'timestamp' | 'reactions'>) => void;
    reactToAnnouncement: (annId: string, emoji: string) => void;
    updateTimetableEntry: (entry: TimetableEntry) => void;
    addTimetableEntry: (entry: Omit<TimetableEntry, 'id'>) => void;
    deleteTimetableEntry: (id: string) => void;
    approveUser: (id: string) => void;
    rejectUser: (id: string) => void;
    setIsChatOpen: React.Dispatch<React.SetStateAction<boolean>>;
    toggleSidebar: () => void;
    addNotification: (notification: Omit<AppNotification, 'id'>) => void;
    setAiModalContent: React.Dispatch<React.SetStateAction<AIModalContent | null>>;
    setStudyToolContent: React.Dispatch<React.SetStateAction<StudyToolContent | null>>;
}

const AppContext = createContext<AppContextType | null>(null);
const useAppContext = () => {
    const context = useContext(AppContext);
    if (!context) throw new Error("useAppContext must be used within an AppProvider");
    return context;
};

// --- Helper Components ---
const Icon: React.FC<{ name: string; className?: string }> = ({ name, className }) => {
    const icons: { [key: string]: React.ReactNode } = {
        'dashboard': <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l3-3m0 0l3 3m-3-3v12.75m3-3l3 3m-3-3V3.75m9 9.75l3-3m0 0l3 3m-3-3V3.75m-6 3.75l-3 3m0 0l3 3m-3-3h12.75" />,
        'timetable': <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0h18M12 12.75h.008v.008H12v-.008z" />,
        'manage': <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />,
        'settings': <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-1.003 1.11-1.226M15 21v-4.502m0 0l-1.465-1.465c-.29-.29-.752-.29-1.042 0l-1.466 1.465m3.973 0V21m-3.973-4.502l-1.465 1.465c-.29.29-.29.752 0 1.042l1.465 1.465m0 0V21m-6.035-6.035l-1.465-1.465c-.29-.29-.752-.29-1.042 0l-1.466 1.465m3.973 0V15m-3.973-4.502l-1.465 1.465c-.29.29-.29.752 0 1.042l1.465 1.465m0 0V15m13.465-6.035l-1.465-1.465c-.29-.29-.752-.29-1.042 0l-1.466 1.465m3.973 0V9m-3.973-4.502l-1.465 1.465c-.29.29-.29.752 0 1.042l1.465 1.465m0 0V9" />,
        'announcements': <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 1.87a.75.75 0 01.41-1.418 12.016 12.016 0 016.89 2.595.75.75 0 01-.58 1.344 10.512 10.512 0 00-6.72-2.52zM3.001 7.69a.75.75 0 010-1.06 11.956 11.956 0 0110.158-4.13.75.75 0 01.83 1.163A10.457 10.457 0 003.34 7.5a.75.75 0 01-.34.19z" />,
        'approvals': <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
        'logout': <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />,
        'moon': <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />,
        'sun': <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />,
        'logo': <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />,
        'menu': <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />,
        'close': <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />,
        'add': <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />,
        'user': <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />,
        'send': <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />,
        'mic': <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5a6 6 0 00-12 0v1.5a6 6 0 006 6zM21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
        'ai_sparkle': <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.898 20.502L16.5 21.75l-.398-1.248a3.375 3.375 0 00-2.456-2.456L12.5 17.25l1.248-.398a3.375 3.375 0 002.456-2.456L16.5 13.5l.398 1.248a3.375 3.375 0 002.456 2.456L20.5 17.25l-1.248.398a3.375 3.375 0 00-2.456 2.456z" />,
        'edit': <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />,
        'delete': <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.134-2.036-2.134H8.716C7.58 2.134 6.67 3.044 6.67 4.22v.916m7.5 0a48.667 48.667 0 00-7.5 0" />,
        'approve': <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />,
        'reject': <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />,
        'class': <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />,
        'link': <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />,
        'open_new': <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />,
        'ai_summarize': <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />,
        'ai_plan': <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m5.231 13.5h3.846A3.375 3.375 0 0019.5 14.25v-2.625" />,
    };
    return (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
            {icons[name]}
        </svg>
    );
};

const LoadingSpinner: React.FC<{ size?: 'sm' | 'md' | 'lg' }> = ({ size = 'md' }) => (
    <div className="spinner" />
);

const Modal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
    size?: 'md' | 'lg' | 'xl';
}> = ({ isOpen, onClose, title, children, size = 'md' }) => {
    if (!isOpen) return null;

    return createPortal(
        <div className="modal-overlay open" onClick={onClose}>
            <div className={`modal-content modal-${size}`} onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>{title}</h3>
                    <button onClick={onClose} className="close-modal-btn" aria-label="Close modal">
                        <Icon name="close" className="w-6 h-6" />
                    </button>
                </div>
                <div className="modal-body">{children}</div>
            </div>
        </div>,
        document.body
    );
};

const NotificationArea: React.FC = () => {
    const { notifications } = useAppContext();
    const [visibleNotifications, setVisibleNotifications] = useState<AppNotification[]>([]);

    useEffect(() => {
        setVisibleNotifications(notifications);
        const timer = setTimeout(() => {
            if (notifications.length > 0) {
                // This is a simplified removal, a real app would use a queue
                setVisibleNotifications(notifications.slice(1));
            }
        }, 5000);
        return () => clearTimeout(timer);
    }, [notifications]);

    if (visibleNotifications.length === 0) return null;

    return createPortal(
        <div className="notification-container">
            {visibleNotifications.map((notif) => (
                <div key={notif.id} className={`notification-item ${notif.type}`}>
                    <span>{notif.message}</span>
                    <button className="notification-dismiss">&times;</button>
                </div>
            ))}
        </div>,
        document.body
    );
};

// --- Main App Components ---

const Sidebar: React.FC = () => {
    const { currentUser, currentView, setCurrentView, logout, isSidebarOpen, toggleSidebar } = useAppContext();

    const navItems: { view: AppView, label: string, icon: string, roles: UserRole[] }[] = [
        { view: 'dashboard', label: 'Dashboard', icon: 'dashboard', roles: ['student', 'faculty', 'hod', 'admin', 'class advisor', 'principal', 'creator'] },
        { view: 'timetable', label: 'Timetable', icon: 'timetable', roles: ['student', 'faculty', 'hod', 'class advisor', 'principal', 'creator'] },
        { view: 'announcements', label: 'Announcements', icon: 'announcements', roles: ['student', 'faculty', 'hod', 'admin', 'class advisor', 'principal', 'creator'] },
        { view: 'manage', label: 'Manage Timetable', icon: 'manage', roles: ['admin', 'hod', 'creator'] },
        { view: 'approvals', label: 'Approvals', icon: 'approvals', roles: ['admin', 'hod', 'principal', 'creator'] },
        { view: 'settings', label: 'Settings', icon: 'settings', roles: ['student', 'faculty', 'hod', 'admin', 'class advisor', 'principal', 'creator'] },
    ];

    const filteredNavItems = navItems.filter(item => currentUser && item.roles.includes(currentUser.role));

    return (
        <>
            <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
                <div className="sidebar-header">
                    <span className="logo"><Icon name="logo" /></span>
                    <h1>Academia AI</h1>
                    <button className="sidebar-close" onClick={toggleSidebar} aria-label="Close sidebar"><Icon name="close" /></button>
                </div>
                <nav className="nav-list">
                    <ul>
                        {filteredNavItems.map(item => (
                            <li key={item.view} className="nav-item">
                                <button
                                    className={currentView === item.view ? 'active' : ''}
                                    onClick={() => {
                                        setCurrentView(item.view);
                                        if (isSidebarOpen) toggleSidebar();
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
                    <div className="user-info">
                        Logged in as <strong>{currentUser?.name}</strong><br />
                        <small>{currentUser?.role}</small>
                    </div>
                    <div className="sidebar-actions">
                        <button onClick={logout} className="logout-btn" aria-label="Log out"><Icon name="logout" /></button>
                    </div>
                </div>
            </aside>
            <div className={`sidebar-overlay ${isSidebarOpen ? 'open' : ''}`} onClick={toggleSidebar}></div>
        </>
    );
};

const Header: React.FC = () => {
    const { currentView, theme, setTheme, toggleSidebar } = useAppContext();
    const viewTitles: Record<AppView, string> = {
        dashboard: 'Dashboard',
        timetable: 'My Timetable',
        manage: 'Manage Timetable',
        settings: 'Settings',
        auth: 'Welcome',
        approvals: 'User Approvals',
        announcements: 'Announcements',
        studentDirectory: 'Student Directory',
        security: 'Security Center',
        userManagement: 'User Management',
        resources: 'Resources',
        academicCalendar: 'Academic Calendar',
        courseFiles: 'Course Files',
    };

    return (
        <header className="header">
            <div className="header-left">
                <button className="menu-toggle" onClick={toggleSidebar} aria-label="Open sidebar"><Icon name="menu" /></button>
                <h2 className="header-title">{viewTitles[currentView] || 'Academia AI'}</h2>
            </div>
            <div className="header-right">
                <button
                    className="theme-toggle"
                    onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                    aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
                >
                    <Icon name={theme === 'light' ? 'moon' : 'sun'} />
                </button>
            </div>
        </header>
    );
};

const AuthView: React.FC = () => {
    const { login, signup, addNotification } = useAppContext();
    const [isFlipped, setIsFlipped] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Login State
    const [loginId, setLoginId] = useState('');
    const [loginPassword, setLoginPassword] = useState('');

    // Signup State
    const [signupName, setSignupName] = useState('');
    const [signupPassword, setSignupPassword] = useState('');
    const [signupRole, setSignupRole] = useState<UserRole>('student');
    const [signupDept, setSignupDept] = useState(DEPARTMENTS[0]);
    const [signupYear, setSignupYear] = useState('I');

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!loginId || !loginPassword) {
            addNotification({ type: 'error', message: 'Please enter both ID and password.' });
            return;
        }
        setIsSubmitting(true);
        const success = await login(loginId, loginPassword);
        setIsSubmitting(false);
        if (!success) {
            addNotification({ type: 'error', message: 'Invalid credentials or user not approved.' });
        }
    };

    const handleSignup = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        const newUser: Omit<User, 'id' | 'status'> = {
            name: signupName,
            password: signupPassword,
            role: signupRole,
            dept: signupDept,
            ...(signupRole === 'student' && { year: signupYear }),
        };
        const success = await signup(newUser);
        setIsSubmitting(false);
        if (success) {
            addNotification({ type: 'success', message: 'Registration successful! Please wait for admin approval.' });
            setIsFlipped(false);
        } else {
            addNotification({ type: 'error', message: 'Registration failed. Please try again.' });
        }
    };

    return (
        <div className="login-view-container">
            <div className="login-card">
                <div className={`login-card-inner ${isFlipped ? 'is-flipped' : ''}`}>
                    <div className="login-card-front">
                        <div className="login-header">
                            <span className="logo"><Icon name="logo" /></span>
                            <h1>Welcome Back</h1>
                        </div>
                        <form onSubmit={handleLogin}>
                            <div className="control-group">
                                <label htmlFor="loginId">User ID</label>
                                <input type="text" id="loginId" className="form-control" value={loginId} onChange={e => setLoginId(e.target.value)} placeholder="e.g., stud001" required />
                            </div>
                            <div className="control-group">
                                <label htmlFor="loginPassword">Password</label>
                                <input type="password" id="loginPassword" className="form-control" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} placeholder="••••••••" required />
                            </div>
                            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                                {isSubmitting ? <LoadingSpinner size="sm" /> : 'Log In'}
                            </button>
                            <div className="auth-toggle">
                                Don't have an account? <button onClick={() => setIsFlipped(true)}>Sign Up</button>
                            </div>
                        </form>
                    </div>
                    <div className="login-card-back">
                        <div className="login-header">
                            <span className="logo"><Icon name="logo" /></span>
                            <h1>Create Account</h1>
                        </div>
                        <form onSubmit={handleSignup}>
                            <div className="control-group">
                                <label htmlFor="signupName">Full Name</label>
                                <input type="text" id="signupName" className="form-control" value={signupName} onChange={e => setSignupName(e.target.value)} required />
                            </div>
                            <div className="control-group">
                                <label htmlFor="signupPassword">Password</label>
                                <input type="password" id="signupPassword" className="form-control" value={signupPassword} onChange={e => setSignupPassword(e.target.value)} required />
                            </div>
                            <div className="form-grid">
                                <div className="control-group">
                                    <label htmlFor="signupRole">Role</label>
                                    <select id="signupRole" className="form-control" value={signupRole} onChange={e => setSignupRole(e.target.value as UserRole)}>
                                        {USER_ROLES.map(r => <option key={r} value={r} style={{ textTransform: 'capitalize' }}>{r}</option>)}
                                    </select>
                                </div>
                                <div className="control-group">
                                    <label htmlFor="signupDept">Department</label>
                                    <select id="signupDept" className="form-control" value={signupDept} onChange={e => setSignupDept(e.target.value)}>
                                        {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                                    </select>
                                </div>
                            </div>
                            {signupRole === 'student' && (
                                <div className="control-group">
                                    <label htmlFor="signupYear">Year</label>
                                    <select id="signupYear" className="form-control" value={signupYear} onChange={e => setSignupYear(e.target.value)}>
                                        <option value="I">I</option>
                                        <option value="II">II</option>
                                        <option value="III">III</option>
                                        <option value="IV">IV</option>
                                    </select>
                                </div>
                            )}
                            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                                {isSubmitting ? <LoadingSpinner size="sm" /> : 'Sign Up'}
                            </button>
                            <div className="auth-toggle">
                                Already have an account? <button onClick={() => setIsFlipped(false)}>Log In</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    );
};

const DashboardView: React.FC = () => {
    const { currentUser, announcements, timetable, users, setCurrentView, setStudyToolContent } = useAppContext();
    const greeting = getGreeting();

    const studentDashboard = () => {
        const myAnnouncements = announcements.filter(a =>
            (a.targetRole === 'all' || a.targetRole === 'student') &&
            (a.targetDept === 'all' || a.targetDept === currentUser?.dept)
        ).slice(0, 3);

        const today = DAYS[new Date().getDay() - 1];
        const myTodaysClasses = timetable.filter(t => t.day === today && t.department === currentUser?.dept && t.year === currentUser?.year && t.type === 'class');

        return (
            <div className="dashboard-grid">
                <div className="dashboard-card full-width stagger-item" style={{ animationDelay: '0.1s' }}>
                    <h2 className="dashboard-greeting">{greeting}, {currentUser?.name}!</h2>
                    <p className="text-secondary">Here's what's happening today.</p>
                </div>

                <div className="dashboard-card stagger-item" style={{ animationDelay: '0.2s' }}>
                    <h3>Today's Classes</h3>
                    {myTodaysClasses.length > 0 ? (
                        <div className="feed-list">
                            {myTodaysClasses.map(c => (
                                <div key={c.id} className="feed-item-card class">
                                    <div className="feed-item-icon"><Icon name="class" /></div>
                                    <div>
                                        <p className="feed-item-title">{c.subject}</p>
                                        <p className="feed-item-meta">{MOCK_SETTINGS.timeSlots[c.timeIndex]} with {c.faculty}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : <p className="text-secondary mt-2">No classes scheduled for today.</p>}
                </div>

                <div className="dashboard-card stagger-item" style={{ animationDelay: '0.3s' }}>
                    <h3>Recent Announcements</h3>
                    {myAnnouncements.length > 0 ? (
                        <div className="feed-list">
                            {myAnnouncements.map(a => (
                                <div key={a.id} className="feed-item-card announcement" onClick={() => setCurrentView('announcements')} style={{ cursor: 'pointer' }}>
                                    <div className="feed-item-icon"><Icon name="announcements" /></div>
                                    <div>
                                        <p className="feed-item-title">{a.title}</p>
                                        <p className="feed-item-meta">By {a.author} - {new Date(a.timestamp).toLocaleDateString()}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : <p className="text-secondary mt-2">No recent announcements.</p>}
                </div>
                <div className="dashboard-card ai-feature-card stagger-item" style={{ animationDelay: '0.4s' }}>
                    <div className="ai-feature-card-header">
                        <Icon name="ai_sparkle" />
                        <h3>AI Study Planner</h3>
                    </div>
                    <p>Generate a personalized study plan based on your upcoming exams and syllabus.</p>
                    <button className="btn btn-primary" onClick={() => setStudyToolContent({ type: 'studyPlan', title: 'Generate Study Plan', content: '', isLoading: false })}>
                        Create Plan
                    </button>
                </div>
            </div>
        );
    };

    const adminDashboard = () => {
        const pendingApprovals = users.filter(u => u.status === 'pending_approval');
        return (
            <div className="dashboard-grid">
                <div className="dashboard-card full-width stagger-item">
                    <h2 className="dashboard-greeting">Admin Dashboard</h2>
                    <p className="text-secondary">System overview and pending tasks.</p>
                </div>
                <div className="dashboard-card stagger-item">
                    <h3>User Approvals</h3>
                    {pendingApprovals.length > 0 ? (
                        <>
                            <p>{pendingApprovals.length} user(s) waiting for approval.</p>
                            <button className="btn btn-primary mt-4" onClick={() => setCurrentView('approvals')}>Review Approvals</button>
                        </>
                    ) : <p className="text-secondary">No pending approvals.</p>}
                </div>
                <div className="dashboard-card stagger-item">
                    <h3>Quick Stats</h3>
                    <div className="principal-stats-grid">
                        <div className="stat-card">
                            <h3>Total Users</h3>
                            <p>{users.length}</p>
                        </div>
                        <div className="stat-card">
                            <h3>Announcements</h3>
                            <p>{announcements.length}</p>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const principalDashboard = () => {
        const studentCount = users.filter(u => u.role === 'student').length;
        const facultyCount = users.filter(u => u.role === 'faculty').length;
        return (
            <div className="dashboard-grid">
                <div className="dashboard-card full-width">
                    <h2 className="dashboard-greeting">{greeting}, {currentUser?.name}!</h2>
                    <p className="text-secondary">Here's a snapshot of the institution.</p>
                </div>
                <div className="dashboard-card">
                    <h3>Institution Statistics</h3>
                    <div className="principal-stats-grid">
                        <div className="stat-card">
                            <h3>Total Students</h3>
                            <p>{studentCount}</p>
                        </div>
                        <div className="stat-card">
                            <h3>Total Faculty</h3>
                            <p>{facultyCount}</p>
                        </div>
                        <div className="stat-card">
                            <h3>Departments</h3>
                            <p>{DEPARTMENTS.length}</p>
                        </div>
                        <div className="stat-card">
                            <h3>Announcements</h3>
                            <p>{announcements.length}</p>
                        </div>
                    </div>
                </div>
            </div>
        );
    };


    const renderDashboard = () => {
        switch (currentUser?.role) {
            case 'student':
            case 'faculty':
            case 'hod':
            case 'class advisor':
                return studentDashboard(); // Simplified for now
            case 'admin':
            case 'creator':
                return adminDashboard();
            case 'principal':
                return principalDashboard();
            default:
                return <p>Welcome!</p>;
        }
    };
    return <div className="dashboard-container">{renderDashboard()}</div>;
};

const TimetableView: React.FC = () => {
    const { currentUser, timetable, settings } = useAppContext();
    const [viewDept, setViewDept] = useState(currentUser?.dept || DEPARTMENTS[0]);
    const [viewYear, setViewYear] = useState(currentUser?.year || 'I');

    const filteredTimetable = timetable.filter(e => e.department === viewDept && e.year === viewYear);

    return (
        <div className="timetable-container">
            <div className="timetable-header">
                <h3>Viewing Timetable for {viewDept} - Year {viewYear}</h3>
                <div className="timetable-controls">
                    <select className="form-control" value={viewDept} onChange={e => setViewDept(e.target.value)}>
                        {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <select className="form-control" value={viewYear} onChange={e => setViewYear(e.target.value)}>
                        <option value="I">I</option>
                        <option value="II">II</option>
                        <option value="III">III</option>
                        <option value="IV">IV</option>
                    </select>
                </div>
            </div>
            <div className="timetable-wrapper">
                <div className="timetable-grid">
                    <div className="grid-header">Time</div>
                    {DAYS.map(day => <div key={day} className="grid-header">{day}</div>)}

                    {settings.timeSlots.map((slot, timeIndex) => (
                        <React.Fragment key={timeIndex}>
                            <div className="time-slot">{slot}</div>
                            {DAYS.map((day, dayIndex) => {
                                const entry = filteredTimetable.find(e => e.day === day && e.timeIndex === timeIndex);
                                return (
                                    <div key={`${day}-${timeIndex}`} className={`grid-cell ${entry?.type || ''}`}>
                                        {entry && (
                                            <>
                                                <span className="subject">{entry.subject}</span>
                                                {entry.type === 'class' && (
                                                    <>
                                                        <span className="faculty">{entry.faculty}</span>
                                                        <span className="faculty">{entry.room}</span>
                                                    </>
                                                )}
                                            </>
                                        )}
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

const ManageTimetableView: React.FC = () => {
    const { timetable, updateTimetableEntry, deleteTimetableEntry } = useAppContext();
    // In a real app, you'd have modals/forms to edit and add entries
    return (
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
                    {timetable.map(entry => (
                        <tr key={entry.id}>
                            <td data-label="Dept">{entry.department}</td>
                            <td data-label="Year">{entry.year}</td>
                            <td data-label="Day">{entry.day}</td>
                            <td data-label="Time">{MOCK_SETTINGS.timeSlots[entry.timeIndex]}</td>
                            <td data-label="Subject">{entry.subject}</td>
                            <td data-label="Faculty">{entry.faculty || 'N/A'}</td>
                            <td data-label="Actions">
                                <div className="entry-actions">
                                    <button className="btn btn-secondary btn-sm"><Icon name="edit" /></button>
                                    <button onClick={() => deleteTimetableEntry(entry.id)} className="btn btn-danger btn-sm"><Icon name="delete" /></button>
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const ApprovalsView: React.FC = () => {
    const { users, approveUser, rejectUser } = useAppContext();
    const pendingUsers = users.filter(u => u.status === 'pending_approval');

    return (
        <div className="table-wrapper">
            <table className="entry-list-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Role</th>
                        <th>Department</th>
                        <th>Year</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {pendingUsers.length > 0 ? pendingUsers.map(user => (
                        <tr key={user.id}>
                            <td data-label="Name">{user.name}</td>
                            <td data-label="Role" style={{ textTransform: 'capitalize' }}>{user.role}</td>
                            <td data-label="Department">{user.dept}</td>
                            <td data-label="Year">{user.year || 'N/A'}</td>
                            <td data-label="Actions">
                                <div className="entry-actions">
                                    <button onClick={() => approveUser(user.id)} className="btn btn-success btn-sm"><Icon name="approve" /> Approve</button>
                                    <button onClick={() => rejectUser(user.id)} className="btn btn-danger btn-sm"><Icon name="reject" /> Reject</button>
                                </div>
                            </td>
                        </tr>
                    )) : (
                        <tr><td colSpan={5} style={{ textAlign: 'center' }}>No pending approvals.</td></tr>
                    )}
                </tbody>
            </table>
        </div>
    );
};

const AnnouncementsView: React.FC = () => {
    const { currentUser, announcements, addAnnouncement, reactToAnnouncement } = useAppContext();
    const [showAddModal, setShowAddModal] = useState(false);
    const [newAnnTitle, setNewAnnTitle] = useState('');
    const [newAnnContent, setNewAnnContent] = useState('');

    const handleAddAnnouncement = () => {
        if (!currentUser) return;
        addAnnouncement({
            title: newAnnTitle,
            content: newAnnContent,
            author: currentUser.name, // Simplified
            targetRole: 'all', // Simplified
            targetDept: 'all', // Simplified
        });
        setShowAddModal(false);
        setNewAnnTitle('');
        setNewAnnContent('');
    };

    return (
        <>
            <div className="view-header">
                <h2>Latest Announcements</h2>
                {(currentUser?.role === 'admin' || currentUser?.role === 'hod' || currentUser?.role === 'principal') && (
                    <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
                        <Icon name="add" /> New Announcement
                    </button>
                )}
            </div>
            {announcements.length > 0 ? (
                <div className="announcement-list">
                    {announcements.map((ann, i) => (
                        <div key={ann.id} className="announcement-card stagger-item" style={{ animationDelay: `${i * 0.1}s` }}>
                            <h3>{ann.title}</h3>
                            <p>{ann.content}</p>
                            <div className="announcement-footer">
                                <div className="meta">By <strong>{ann.author}</strong> on {new Date(ann.timestamp).toLocaleDateString()}</div>
                                <div className="reactions">
                                    {['👍', '❤️', '🎉'].map(emoji => (
                                        <button
                                            key={emoji}
                                            onClick={() => reactToAnnouncement(ann.id, emoji)}
                                            className={ann.reactions?.[emoji]?.includes(currentUser?.id || '') ? 'active' : ''}
                                        >
                                            {emoji} {ann.reactions?.[emoji]?.length || 0}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="empty-state">
                    <p>No announcements yet. Check back later!</p>
                </div>
            )}
            <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="New Announcement">
                <div className="control-group">
                    <label htmlFor="annTitle">Title</label>
                    <input type="text" id="annTitle" className="form-control" value={newAnnTitle} onChange={e => setNewAnnTitle(e.target.value)} />
                </div>
                <div className="control-group">
                    <label htmlFor="annContent">Content</label>
                    <textarea id="annContent" className="form-control" rows={5} value={newAnnContent} onChange={e => setNewAnnContent(e.target.value)}></textarea>
                </div>
                <button className="btn btn-primary" onClick={handleAddAnnouncement}>Post Announcement</button>
            </Modal>
        </>
    );
};

const SettingsView: React.FC = () => {
    return (
        <div className="dashboard-card">
            <h3>Settings</h3>
            <p className="text-secondary">Manage your account and application settings here.</p>
            {/* Settings form would go here */}
        </div>
    );
};

// --- Floating Windows and Chatbot ---

const DraggableResizableWindow: React.FC<{
    id: string;
    initialPosition: { x: number, y: number };
    initialSize: { width: number, height: number };
    title: string;
    onClose: (id: string) => void;
    children: React.ReactNode;
}> = ({ id, initialPosition, initialSize, title, onClose, children }) => {
    const [position, setPosition] = useState(initialPosition);
    const [size, setSize] = useState(initialSize);
    const windowRef = useRef<HTMLDivElement>(null);

    // Dragging logic
    const handleDrag = useCallback((e: MouseEvent) => {
        const dx = e.movementX;
        const dy = e.movementY;
        setPosition(pos => {
            const newX = Math.max(0, Math.min(window.innerWidth - size.width, pos.x + dx));
            const newY = Math.max(0, Math.min(window.innerHeight - size.height, pos.y + dy));
            return { x: newX, y: newY };
        });
    }, [size.width, size.height]);

    const stopDrag = useCallback(() => {
        window.removeEventListener('mousemove', handleDrag);
        window.removeEventListener('mouseup', stopDrag);
    }, [handleDrag]);

    const startDrag = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        window.addEventListener('mousemove', handleDrag);
        window.addEventListener('mouseup', stopDrag);
    }, [handleDrag, stopDrag]);


    // Resizing logic
    const handleResize = useCallback((e: MouseEvent) => {
        const dx = e.movementX;
        const dy = e.movementY;
        setSize(s => ({
            width: Math.max(300, s.width + dx),
            height: Math.max(200, s.height + dy)
        }));
    }, []);

    const stopResize = useCallback(() => {
        window.removeEventListener('mousemove', handleResize);
        window.removeEventListener('mouseup', stopResize);
    }, [handleResize]);

    const startResize = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        window.addEventListener('mousemove', handleResize);
        window.addEventListener('mouseup', stopResize);
    }, [handleResize, stopResize]);


    return (
        <div
            ref={windowRef}
            className="floating-window"
            style={{
                transform: `translate(${position.x}px, ${position.y}px)`,
                width: `${size.width}px`,
                height: `${size.height}px`,
            }}
        >
            <div className="floating-window-header" onMouseDown={startDrag}>
                <h3>{title}</h3>
                <button onClick={() => onClose(id)} aria-label="Close window"><Icon name="close" /></button>
            </div>
            <div className="floating-window-content">
                {children}
            </div>
            <div className="resize-handle" onMouseDown={startResize}></div>
        </div>
    );
};

const WebViewWindow: React.FC<{ url: string }> = ({ url }) => {
    const { setAiModalContent } = useAppContext();
    const [isLoading, setIsLoading] = useState(false);

    const summarizePage = async () => {
        if (!ai) return;
        setIsLoading(true);
        setAiModalContent({ title: "Summarizing Content", content: "", isLoading: true });
        try {
            // NOTE: In a real app, you can't access iframe content due to CORS.
            // This is a simulation. You'd need a backend proxy to fetch the content.
            const prompt = `Please summarize the content from the URL: ${url}. Focus on the key points and provide a concise overview.`;
            const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
            setAiModalContent({ title: "AI Summary", content: response.text, isLoading: false });
        } catch (error) {
            console.error("AI summarization failed:", error);
            setAiModalContent({ title: "Error", content: "Failed to summarize the content.", isLoading: false });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="webview-container">
            <iframe src={url} title={url}></iframe>
            <div className="webview-footer">
                <a href={url} target="_blank" rel="noopener noreferrer" className="open-new-tab-link"><Icon name="open_new" /></a>
                <div className="webview-ai-actions">
                    <button className="btn btn-secondary btn-sm" onClick={summarizePage} disabled={!isAiEnabled || isLoading}>
                        {isLoading ? <LoadingSpinner size="sm" /> : <Icon name="ai_summarize" />} Summarize
                    </button>
                </div>
            </div>
        </div>
    );
};

const ChatbotWindow: React.FC = () => {
    const { setIsChatOpen, currentUser } = useAppContext();
    const [chat, setChat] = useState<Chat | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const recognitionRef = useRef<any>(null); // SpeechRecognition instance

    useEffect(() => {
        if (!ai) return;
        const systemInstruction = `You are Academia AI, a helpful assistant for students, faculty, and administrators in an educational institution. 
        Your primary role is to provide accurate, relevant, and concise information based on the user's role and context.
        Current user: ${currentUser?.name} (Role: ${currentUser?.role}, Department: ${currentUser?.dept}).
        You can answer questions about schedules, academic policies, find resources, and explain concepts.
        If a user asks for information that might be on the web, use the Google Search tool. Always cite your sources when using search.
        Keep responses friendly and professional. Format your responses with markdown for readability.`;

        const newChat = ai.chats.create({
            model: 'gemini-2.5-flash',
            config: {
                systemInstruction,
                tools: [{ googleSearch: {} }]
            },
        });
        setChat(newChat);
    }, [currentUser]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const getDisplayUrl = (uri: string) => {
        try {
            return new URL(uri).hostname;
        } catch (e) {
            // if parsing fails, return a truncated version of the original string
            return uri.length > 30 ? uri.substring(0, 27) + '...' : uri;
        }
    };

    const sendMessage = async () => {
        if (!chat || !input.trim()) return;
        const userMessage: ChatMessage = { id: Date.now().toString(), role: 'user', text: input };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);

        try {
            const result: GenerateContentResponse = await chat.sendMessage({ message: input });
            const modelResponse = result;
            const sources = modelResponse.candidates?.[0]?.groundingMetadata?.groundingChunks
                ?.map(chunk => chunk.web)
                .filter(web => web?.uri && web?.title) as { uri: string, title: string }[] | undefined;

            const modelMessage: ChatMessage = {
                id: (Date.now() + 1).toString(),
                role: 'model',
                text: modelResponse.text,
                sources: sources,
            };
            setMessages(prev => [...prev, modelMessage]);
        } catch (error) {
            console.error("Chat error:", error);
            const errorMessage: ChatMessage = {
                id: (Date.now() + 1).toString(),
                role: 'model',
                text: "Sorry, I encountered an error. Please try again.",
                isError: true
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSpeech = () => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert("Speech recognition not supported in this browser.");
            return;
        }

        if (isListening) {
            recognitionRef.current?.stop();
            setIsListening(false);
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';
        recognitionRef.current = recognition;

        recognition.onstart = () => setIsListening(true);
        recognition.onend = () => setIsListening(false);
        recognition.onerror = (event: any) => {
            console.error("Speech recognition error", event.error);
            setIsListening(false);
        };
        recognition.onresult = (event: any) => {
            const transcript = event.results[0][0].transcript;
            setInput(transcript);
        };

        recognition.start();
    };

    return (
        <div className="chatbot-window">
            <div className="chatbot-header">
                <h3>AI Assistant</h3>
                <button onClick={() => setIsChatOpen(false)}><Icon name="close" /></button>
            </div>
            <div className="chatbot-messages">
                {messages.length === 0 ? (
                    <div className="chat-empty-state">
                        <p>Hi, I'm your Academia AI assistant!</p>
                        <p>You can ask me things like:</p>
                        <ul>
                            <li><code>"When is my Data Structures class?"</code></li>
                            <li><code>"Summarize the latest announcement."</code></li>
                            <li><code>"Explain the concept of recursion."</code></li>
                        </ul>
                    </div>
                ) : (
                    messages.map((msg, index) => (
                        <div key={msg.id} className={`chat-message ${msg.role} ${msg.isError ? 'error' : ''}`}>
                            <div className="chat-bubble">
                                <div dangerouslySetInnerHTML={{ __html: marked.parse(msg.text) }} />
                                {msg.imageUrl && <img src={msg.imageUrl} alt="Chat content" className="chat-image" />}
                                {msg.sources && msg.sources.length > 0 && (
                                    <div className="chat-sources">
                                        <h4>Sources:</h4>
                                        <ul>
                                            {msg.sources.map((source, i) => (
                                                <li key={i}>
                                                    <a href={source.uri} target="_blank" rel="noopener noreferrer">
                                                        <Icon name="link" />
                                                        <span>{source.title || getDisplayUrl(source.uri)}</span>
                                                    </a>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))
                )}
                {isLoading && (
                    <div className="chat-message model">
                        <div className="chat-bubble">
                            <div className="loading-dots"><span></span><span></span><span></span></div>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>
            <form className="chatbot-input-form" onSubmit={(e) => { e.preventDefault(); sendMessage(); }}>
                <input
                    type="text"
                    placeholder="Ask me anything..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    disabled={isLoading}
                />
                <button type="button" onClick={handleSpeech} className={`mic-btn ${isListening ? 'listening' : ''}`} disabled={isLoading}>
                    <Icon name="mic" />
                </button>
                <button type="submit" disabled={isLoading || !input.trim()}>
                    <Icon name="send" />
                </button>
            </form>
        </div>
    );
};

const ChatbotFab: React.FC = () => {
    const { isChatOpen, setIsChatOpen } = useAppContext();
    const fabRef = useRef<HTMLButtonElement>(null);
    const [position, setPosition] = useState({ x: 32, y: 32 }); // position from bottom-right
    const isDraggingRef = useRef(false);

    const toggleChat = () => {
        if (!isDraggingRef.current) {
            setIsChatOpen(prev => !prev);
        }
    };

    // Dragging logic for the FAB
    useEffect(() => {
        const fab = fabRef.current;
        if (!fab) return;

        let offset = { x: 0, y: 0 };

        const onMouseMove = (e: MouseEvent) => {
            isDraggingRef.current = true;
            fab.classList.add('dragging');
            setPosition({
                x: window.innerWidth - (e.clientX - offset.x),
                y: window.innerHeight - (e.clientY - offset.y),
            });
        };

        const onMouseUp = () => {
            fab.classList.remove('dragging');
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            // Use a timeout to differentiate drag from click
            setTimeout(() => { isDraggingRef.current = false; }, 100);
        };

        const onMouseDown = (e: MouseEvent) => {
            offset = { x: e.clientX - fab.getBoundingClientRect().left, y: e.clientY - fab.getBoundingClientRect().top };
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };

        fab.addEventListener('mousedown', onMouseDown);

        return () => {
            fab.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
    }, []);

    return (
        <>
            <button
                ref={fabRef}
                className="chatbot-fab"
                onClick={toggleChat}
                style={{ right: `${position.x}px`, bottom: `${position.y}px` }}
                aria-label="Toggle AI Assistant"
            >
                <Icon name={isChatOpen ? 'close' : 'ai_sparkle'} />
            </button>
            {isChatOpen && <ChatbotWindow />}
        </>
    );
};

const AIStudyTool: React.FC = () => {
    const { studyToolContent, setStudyToolContent } = useAppContext();
    const [isLoading, setIsLoading] = useState(false);
    const [generatedContent, setGeneratedContent] = useState('');

    const handleClose = () => {
        setStudyToolContent(null);
        setGeneratedContent('');
    };

    const handleGenerate = async () => {
        if (!ai || !studyToolContent) return;
        setIsLoading(true);
        setGeneratedContent('');
        const prompt = studyToolContent.type === 'studyPlan'
            ? "Based on a standard computer science curriculum for a second-year student, create a 7-day study plan to prepare for a Data Structures final exam. The plan should cover topics like Arrays, Linked Lists, Stacks, Queues, Trees, Graphs, and Sorting Algorithms. Include daily topics, suggested study times, and practice problems."
            : "Summarize the key concepts of Object-Oriented Programming.";

        try {
            const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
            setGeneratedContent(marked.parse(response.text) as string);
        } catch (error) {
            console.error("AI tool error:", error);
            setGeneratedContent("<p>Sorry, there was an error generating the content.</p>");
        } finally {
            setIsLoading(false);
        }
    };

    if (!studyToolContent) return null;

    return (
        <Modal isOpen={true} onClose={handleClose} title={studyToolContent.title} size="lg">
            {!generatedContent && !isLoading && (
                <div>
                    <p>Click the button below to generate your content using AI.</p>
                    <button className="btn btn-primary" onClick={handleGenerate}>Generate</button>
                </div>
            )}
            {isLoading && (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
                    <LoadingSpinner />
                </div>
            )}
            {generatedContent && (
                <div className="study-plan-content" dangerouslySetInnerHTML={{ __html: generatedContent }} />
            )}
        </Modal>
    );
};


// --- App Component ---
const App: React.FC = () => {
    const [currentUser, setCurrentUser] = usePersistentState<User | null>('currentUser', null);
    const [currentView, setCurrentView] = usePersistentState<AppView>('currentView', 'auth');
    const [theme, setTheme] = usePersistentState<'light' | 'dark'>('theme', 'light');
    const [users, setUsers] = usePersistentState<User[]>('users', MOCK_USERS);
    const [announcements, setAnnouncements] = usePersistentState<Announcement[]>('announcements', MOCK_ANNOUNCEMENTS);
    const [timetable, setTimetable] = usePersistentState<TimetableEntry[]>('timetable', MOCK_TIMETABLE);
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 1024);
    const [notifications, setNotifications] = useState<AppNotification[]>([]);
    const [aiModalContent, setAiModalContent] = useState<AIModalContent | null>(null);
    const [studyToolContent, setStudyToolContent] = useState<StudyToolContent | null>(null);

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
    }, [theme]);

    useEffect(() => {
        if (currentUser) {
            setCurrentView('dashboard');
        } else {
            setCurrentView('auth');
        }
    }, [currentUser]);

    const addNotification = useCallback((notification: Omit<AppNotification, 'id'>) => {
        const newNotification = { ...notification, id: Date.now().toString() };
        setNotifications(prev => [...prev, newNotification]);
        setTimeout(() => {
            setNotifications(prev => prev.filter(n => n.id !== newNotification.id));
        }, 5000);
    }, []);

    const login = async (id: string, pass: string): Promise<boolean> => {
        // Mock login: in a real app, this would be an API call
        console.log(`Attempting login for user: ${id}`);
        const user = users.find(u => u.id === id); // Password check omitted for mock
        if (user && user.status === 'active') {
            setCurrentUser(user);
            addNotification({ type: 'success', message: `Welcome back, ${user.name}!` });
            return true;
        }
        return false;
    };

    const logout = () => {
        setCurrentUser(null);
        addNotification({ type: 'info', message: 'You have been logged out.' });
    };

    const signup = async (user: Omit<User, 'id' | 'status'>): Promise<boolean> => {
        // Mock signup
        const newId = `user_${Date.now()}`;
        const newUser: User = { ...user, id: newId, status: 'pending_approval' };
        setUsers(prev => [...prev, newUser]);
        return true;
    };

    const updateUser = (updatedUser: User) => {
        setUsers(users.map(u => u.id === updatedUser.id ? updatedUser : u));
    };

    const addAnnouncement = (ann: Omit<Announcement, 'id' | 'timestamp' | 'reactions'>) => {
        const newAnnouncement: Announcement = { ...ann, id: `ann_${Date.now()}`, timestamp: Date.now() };
        setAnnouncements(prev => [newAnnouncement, ...prev]);
        addNotification({ type: 'success', message: 'Announcement posted.' });
    };

    const reactToAnnouncement = (annId: string, emoji: string) => {
        if (!currentUser) return;
        const userId = currentUser.id;
        setAnnouncements(prev => prev.map(ann => {
            if (ann.id === annId) {
                const reactions = { ...(ann.reactions || {}) };
                const usersWhoReacted = reactions[emoji] || [];
                if (usersWhoReacted.includes(userId)) {
                    reactions[emoji] = usersWhoReacted.filter(id => id !== userId);
                } else {
                    reactions[emoji] = [...usersWhoReacted, userId];
                }
                return { ...ann, reactions };
            }
            return ann;
        }));
    };

    const approveUser = (id: string) => {
        setUsers(prev => prev.map(u => u.id === id ? { ...u, status: 'active' } : u));
        addNotification({ type: 'success', message: 'User approved.' });
    };

    const rejectUser = (id: string) => {
        setUsers(prev => prev.map(u => u.id === id ? { ...u, status: 'rejected' } : u));
        addNotification({ type: 'warning', message: 'User rejected.' });
    };

    const updateTimetableEntry = (entry: TimetableEntry) => {
        setTimetable(prev => prev.map(t => t.id === entry.id ? entry : t));
    };
    const addTimetableEntry = (entry: Omit<TimetableEntry, 'id'>) => {
        const newEntry = { ...entry, id: `tt_${Date.now()}` };
        setTimetable(prev => [...prev, newEntry]);
    };
    const deleteTimetableEntry = (id: string) => {
        setTimetable(prev => prev.filter(t => t.id !== id));
    };

    const toggleSidebar = () => setIsSidebarOpen(prev => !prev);


    const contextValue = useMemo(() => ({
        currentUser,
        currentView,
        theme,
        settings: MOCK_SETTINGS,
        users,
        announcements,
        timetable,
        isChatOpen,
        isSidebarOpen,
        notifications,
        aiModalContent,
        studyToolContent,
        login,
        logout,
        signup,
        setCurrentView,
        setTheme,
        updateUser,
        addAnnouncement,
        reactToAnnouncement,
        updateTimetableEntry,
        addTimetableEntry,
        deleteTimetableEntry,
        approveUser,
        rejectUser,
        setIsChatOpen,
        toggleSidebar,
        addNotification,
        setAiModalContent,
        setStudyToolContent,
    }), [
        currentUser, currentView, theme, users, announcements, timetable, isChatOpen,
        isSidebarOpen, notifications, addNotification, aiModalContent, studyToolContent
    ]);

    const renderView = () => {
        if (!currentUser) return <AuthView />;
        switch (currentView) {
            case 'dashboard': return <DashboardView />;
            case 'timetable': return <TimetableView />;
            case 'manage': return <ManageTimetableView />;
            case 'approvals': return <ApprovalsView />;
            case 'announcements': return <AnnouncementsView />;
            case 'settings': return <SettingsView />;
            default: return <DashboardView />;
        }
    };

    return (
        <AppContext.Provider value={contextValue}>
            <div className={`app-container ${isSidebarOpen ? 'sidebar-open' : ''}`}>
                {currentUser ? (
                    <>
                        <Sidebar />
                        <main className="main-content">
                            <Header />
                            <div className="page-content">{renderView()}</div>
                        </main>
                        <ChatbotFab />
                    </>
                ) : (
                    <AuthView />
                )}
                <NotificationArea />
                <Modal
                    isOpen={!!aiModalContent}
                    onClose={() => setAiModalContent(null)}
                    title={aiModalContent?.title || "AI Assistant"}
                    size="lg"
                >
                    {aiModalContent?.isLoading ? (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}><LoadingSpinner /></div>
                    ) : (
                        <div className="ai-modal-content" dangerouslySetInnerHTML={{ __html: marked.parse(aiModalContent?.content || "") }} />
                    )}
                </Modal>
                <AIStudyTool />
            </div>
        </AppContext.Provider>
    );
};

// --- Mount Application ---
const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
} else {
    console.error("Root container not found. App could not be mounted.");
}
