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

if (API_KEY) {
    try {
        ai = new GoogleGenAI({ apiKey: API_KEY });
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
}
interface LeaveRequest {
    id: string;
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
    targetDept: 'all' | 'CSE' | 'ECE' | 'EEE';
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


type DaySchedule = Period[];
type TimetableData = Record<string, Record<string, DaySchedule[]>>;
type UserRole = 'student' | 'faculty' | 'hod' | 'admin' | 'class advisor';
type AppView = 'home' | 'dashboard' | 'timetable' | 'manage' | 'settings' | 'auth' | 'approvals' | 'announcements' | 'studentDirectory';
interface ManageFormData {
    department: string;
    year: string;
    day: string;
    timeIndex: number;
    subject: string;
    type: 'break' | 'class' | 'common';
    faculty?: string;
}
interface User {
    id: string; // This will be the username/login ID
    name: string;
    password?: string; // Not ideal for prod, but necessary for this structure
    role: UserRole;
    dept: string;
    year?: string;
    status: 'active' | 'pending_approval';
    aiAssessment?: string; // For admin review
    aiSummary?: string; // For student performance summaries
}
interface ResourceRequest {
    id: string;
    userId: string;
    userName: string;
    userRole: UserRole;
    userDept: string;
    userYear?: string;
    requestText: string;
    timestamp: number;
    status: 'pending' | 'approved' | 'rejected';
    aiAssessment?: string;
}
interface AttendanceRecord {
    studentId: string;
    records: Record<string, 'present' | 'absent' | 'late'>; // Key is day name (e.g., "Monday")
}
interface AISummary {
    studentId: string;
    summary: string;
    timestamp: number;
}


const defaultTimeSlots = [
    "09:00 - 09:50", "09:50 - 10:35", "10:35 - 10:50", "10:50 - 11:35",
    "11:35 - 12:20", "12:20 - 01:05", "01:05 - 02:00", "02:00 - 02:50",
    "02:50 - 03:40", "03:40 - 04:30"
];
const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const departments = ["CSE", "ECE", "EEE"];
const years = ["Year 1", "Year 2", "Year 3", "Year 4"];
const facultyNames = ["Ms. YUVASRI", "Mrs. THANGAMANI", "Mr. SOUNDHUR", "Ms. MYSHREE B", "Mrs. ANITHA M AP/MCA", "Dr. A", "Dr. B", "Dr. C", "Dr. D", "Dr. E", "Prof. X", "Prof. Y", "Prof. Z"];
const privilegedRoles: UserRole[] = ['faculty', 'hod', 'admin', 'class advisor'];
const adminRoles: UserRole[] = ['hod', 'admin'];

const staffUsers: User[] = [
    { id: 'yusri', name: 'Ms. YUVASRI', role: 'faculty', dept: 'CSE', status: 'active', password: 'password' },
    { id: 'thangamani', name: 'Mrs. THANGAMANI', role: 'faculty', dept: 'ECE', status: 'active', password: 'password' },
    { id: 'soundhur', name: 'Mr. SOUNDHUR', role: 'faculty', dept: 'EEE', status: 'active', password: 'password' },
    { id: 'dr_a', name: 'Dr. A', role: 'hod', dept: 'CSE', status: 'active', password: 'password' },
    { id: 'admin', name: 'Admin', role: 'admin', dept: 'all', status: 'active', password: 'password' },
    { id: 'advisor_cse1', name: 'Ms. MYSHREE B', role: 'class advisor', dept: 'CSE', status: 'active', password: 'password' }
];
const mockStudents: User[] = [
    { id: 'stu_cse1_001', name: 'Aarav Kumar', role: 'student', dept: 'CSE', year: 'Year 1', status: 'active', password: 'password' },
    { id: 'stu_cse1_002', name: 'Diya Sharma', role: 'student', dept: 'CSE', year: 'Year 1', status: 'active', password: 'password' },
    { id: 'stu_ece2_001', name: 'Rohan Gupta', role: 'student', dept: 'ECE', year: 'Year 2', status: 'active', password: 'password' },
    { id: 'stu_ece2_002', name: 'Priya Patel', role: 'student', dept: 'ECE', year: 'Year 2', status: 'active', password: 'password' },
    { id: 'stu_eee3_001', name: 'Vikram Singh', role: 'student', dept: 'EEE', year: 'Year 3', status: 'active', password: 'password' },
    { id: 'stu_eee3_002', name: 'Anika Reddy', role: 'student', dept: 'EEE', year: 'Year 3', status: 'active', password: 'password' },
    { id: 'stu_cse4_001', name: 'Siddharth Menon', role: 'student', dept: 'CSE', year: 'Year 4', status: 'active', password: 'password' },
    { id: 'stu_cse4_002', name: 'Isha Nair', role: 'student', dept: 'CSE', year: 'Year 4', status: 'active', password: 'password' }
];
const allUsers = [...staffUsers, ...mockStudents];

const mockResourceRequests: ResourceRequest[] = [
    { id: 'req1', userId: 'stu_cse4_001', userName: 'Siddharth Menon', userRole: 'student', userDept: 'CSE', userYear: 'Year 4', requestText: 'Requesting access to the AI/ML lab for final year project.', timestamp: Date.now() - 86400000 * 2, status: 'approved' },
    { id: 'req2', userId: 'stu_ece2_001', userName: 'Rohan Gupta', userRole: 'student', userDept: 'ECE', userYear: 'Year 2', requestText: 'Need oscilloscope from electronics lab for IoT project.', timestamp: Date.now() - 86400000, status: 'pending' },
    { id: 'req3', userId: 'soundhur', userName: 'Mr. SOUNDHUR', userRole: 'faculty', userDept: 'EEE', requestText: 'Projector required for EEE seminar hall on Friday.', timestamp: Date.now() - 3600000, status: 'approved' },
    { id: 'req4', userId: 'stu_cse1_002', userName: 'Diya Sharma', userRole: 'student', userDept: 'CSE', userYear: 'Year 1', requestText: 'Requesting library books for "Data Structures and Algorithms".', timestamp: Date.now(), status: 'rejected' }
];

const mockAnnouncements: Announcement[] = [
    { id: 'ann1', title: 'Mid-Term Examinations Schedule', content: 'The mid-term examinations for all departments will commence from the 15th of next month. The detailed schedule is available on the college notice board and the website.', author: 'Admin', timestamp: Date.now() - 86400000 * 3, targetRole: 'all', targetDept: 'all' },
    { id: 'ann2', title: 'Guest Lecture on AI in Robotics', content: 'The Department of CSE is organizing a guest lecture on "The Future of AI in Robotics" by Dr. Evelyn Reed. All students and faculty are invited. Venue: Seminar Hall A, Time: 10:00 AM, tomorrow.', author: 'HOD (CSE)', timestamp: Date.now() - 86400000, targetRole: 'all', targetDept: 'CSE' },
    { id: 'ann3', title: 'ECE Departmental Meeting', content: 'A meeting for all ECE faculty members will be held this Friday at 3:00 PM in the HOD\'s office to discuss the new curriculum.', author: 'HOD (ECE)', timestamp: Date.now() - 3600000 * 2, targetRole: 'faculty', targetDept: 'ECE' }
];

const mockAttendance: Record<string, AttendanceRecord> = {
    'stu_cse1_001': { studentId: 'stu_cse1_001', records: { 'Monday': 'present', 'Tuesday': 'present', 'Wednesday': 'late', 'Thursday': 'present', 'Friday': 'absent' } },
    'stu_cse1_002': { studentId: 'stu_cse1_002', records: { 'Monday': 'present', 'Tuesday': 'present', 'Wednesday': 'present', 'Thursday': 'present', 'Friday': 'present' } },
    'stu_ece2_001': { studentId: 'stu_ece2_001', records: { 'Monday': 'present', 'Tuesday': 'late', 'Wednesday': 'late', 'Thursday': 'present', 'Friday': 'present' } },
};

const mockSummaries: Record<string, AISummary> = {
    'stu_cse1_001': { studentId: 'stu_cse1_001', summary: "Aarav Kumar has a generally good attendance record but shows a concerning pattern of lateness on Wednesdays and a recent absence on Friday. Academically, he is performing well in programming subjects but could improve in theoretical computer science concepts. He has not requested any special resources recently.", timestamp: Date.now() },
    'stu_ece2_001': { studentId: 'stu_ece2_001', summary: "Rohan Gupta shows a consistent pattern of being late at the beginning of the week. His academic performance is average, with strengths in practical lab work. He has an active resource request for an oscilloscope, indicating engagement in project work. His attendance should be monitored.", timestamp: Date.now() },
};

// --- ICONS ---
const Icons = {
    logo: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 12l10-5 10 5-10 5-10-5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 12v5a1 1 0 001 1h18a1 1 0 001-1v-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 22V17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 12l3-2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>,
    home: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>,
    dashboard: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>,
    timetable: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>,
    manage: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line></svg>,
    approvals: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"></path><path d="m9 12 2 2 4-4"></path></svg>,
    announcements: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 11 18-5v12L3 13V11zM11.6 16.8a3 3 0 1 1-5.7-1.6"></path></svg>,
    students: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>,
    settings: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>,
    sun: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>,
    moon: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>,
    edit: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>,
    delete: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>,
    plus: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>,
    ai: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v0A2.5 2.5 0 0 1 9.5 7v0A2.5 2.5 0 0 1 7 4.5v0A2.5 2.5 0 0 1 9.5 2Z" /><path d="M14.5 2A2.5 2.5 0 0 1 17 4.5v0A2.5 2.5 0 0 1 14.5 7v0A2.5 2.5 0 0 1 12 4.5v0A2.5 2.5 0 0 1 14.5 2Z" /><path d="M12 12a2.5 2.5 0 0 1 2.5 2.5v0a2.5 2.5 0 0 1-5 0v0A2.5 2.5 0 0 1 12 12Z" /><path d="M18 11a2.5 2.5 0 0 1 2.5 2.5v0a2.5 2.5 0 0 1-5 0v0a2.5 2.5 0 0 1 2.5-2.5Z" /><path d="M6 11a2.5 2.5 0 0 1 2.5 2.5v0a2.5 2.5 0 0 1-5 0v0A2.5 2.5 0 0 1 6 11Z" /><path d="M16 18.5a2.5 2.5 0 0 1 2.5 2.5v0a2.5 2.5 0 0 1-5 0v0a2.5 2.5 0 0 1 2.5-2.5Z" /><path d="M8 18.5a2.5 2.5 0 0 1 2.5 2.5v0a2.5 2.5 0 0 1-5 0v0A2.5 2.5 0 0 1 8 18.5Z" /></svg>,
    close: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>,
    send: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>,
    menu: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>,
    checkCircle: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>,
    xCircle: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>,
    save: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>,
    mic: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>,
    volumeOn: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>,
    volumeOff: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>,
};


// --- DATABASE HOOK ---
const useLocalDatabase = () => {
    const [data, setData] = useState({
        timetableEntries: [] as TimetableEntry[],
        leaveRequests: [] as LeaveRequest[],
        announcements: [] as Announcement[],
        timeSlots: defaultTimeSlots,
        users: allUsers,
        resourceRequests: mockResourceRequests,
        attendance: mockAttendance,
        summaries: mockSummaries
    });

    const [isInitialized, setIsInitialized] = useState(false);

    useEffect(() => {
        const storedData = localStorage.getItem('academic-app-data');
        if (storedData) {
            setData(JSON.parse(storedData));
        } else {
            // Seed with mock data if none exists
            setData(prev => ({ ...prev, announcements: mockAnnouncements }));
        }
        setIsInitialized(true);
    }, []);

    useEffect(() => {
        if (isInitialized) {
            localStorage.setItem('academic-app-data', JSON.stringify(data));
        }
    }, [data, isInitialized]);

    const addTimetableEntry = (entry: Omit<TimetableEntry, 'id'>) => {
        const newEntry = { ...entry, id: `tt-${Date.now()}` };
        setData(prev => ({
            ...prev,
            timetableEntries: [...prev.timetableEntries, newEntry],
        }));
        return newEntry;
    };

    const updateTimetableEntry = (id: string, updatedEntry: Partial<TimetableEntry>) => {
        let entryToUpdate: TimetableEntry | undefined;
        setData(prev => ({
            ...prev,
            timetableEntries: prev.timetableEntries.map(e => {
                if (e.id === id) {
                    entryToUpdate = { ...e, ...updatedEntry };
                    return entryToUpdate;
                }
                return e;
            }),
        }));
        return entryToUpdate;
    };

    const deleteTimetableEntry = (id: string) => {
        setData(prev => ({
            ...prev,
            timetableEntries: prev.timetableEntries.filter(e => e.id !== id),
        }));
        return { success: true, id };
    };

    const addAnnouncement = (ann: Omit<Announcement, 'id' | 'timestamp'>) => {
        const newAnnouncement = { ...ann, id: `ann-${Date.now()}`, timestamp: Date.now() };
        setData(prev => ({
            ...prev,
            announcements: [newAnnouncement, ...prev.announcements]
        }));
        return newAnnouncement;
    };

    const deleteAnnouncement = (id: string) => {
        setData(prev => ({
            ...prev,
            announcements: prev.announcements.filter(a => a.id !== id)
        }));
        return { success: true, id };
    };

    const updateTimeslots = (newTimeslots: string[]) => {
        setData(prev => ({ ...prev, timeSlots: newTimeslots }));
    };

    const addUser = (user: User) => {
        setData(prev => ({
            ...prev,
            users: [...prev.users, user],
        }));
    };

    const updateUser = (id: string, updates: Partial<User>) => {
        setData(prev => ({
            ...prev,
            users: prev.users.map(u => (u.id === id ? { ...u, ...updates } : u)),
        }));
    };
    
    const updateUserStatus = (id: string, status: 'active' | 'pending_approval') => {
        let updatedUser: User | undefined;
        setData(prev => ({
            ...prev,
            users: prev.users.map(u => {
                if (u.id === id) {
                    updatedUser = { ...u, status };
                    return updatedUser;
                }
                return u;
            }),
        }));
        return updatedUser;
    };


    const deleteUser = (id: string) => {
        const userExists = data.users.some(u => u.id === id);
        if (!userExists) return { success: false, message: `User with ID '${id}' not found.`};
        setData(prev => ({
            ...prev,
            users: prev.users.filter(u => u.id !== id),
        }));
        return { success: true, id };
    };


    return { ...data, isInitialized, addTimetableEntry, updateTimetableEntry, deleteTimetableEntry, addAnnouncement, deleteAnnouncement, updateTimeslots, addUser, updateUser, deleteUser, updateUserStatus };
};

// --- CONTEXTS ---
type AppContextType = ReturnType<typeof useLocalDatabase>;
const AppContext = createContext<AppContextType | null>(null);
const useAppContext = () => {
    const context = useContext(AppContext);
    if (!context) throw new Error("useAppContext must be used within an AppProvider");
    return context;
};

interface AuthContextType {
    currentUser: User | null;
    login: (id: string, pass: string) => Promise<User | null>;
    logout: () => void;
}
const AuthContext = createContext<AuthContextType | null>(null);
const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error("useAuth must be used within an AuthProvider");
    return context;
};

type NotificationType = 'info' | 'success' | 'error';
type Notification = { id: number; message: string; type: NotificationType };
interface NotificationContextType {
    addNotification: (message: string, type?: NotificationType) => void;
}
const NotificationContext = createContext<NotificationContextType | null>(null);
const useNotifications = () => {
    const context = useContext(NotificationContext);
    if (!context) throw new Error("useNotifications must be used within a NotificationProvider");
    return context;
};

// --- PROVIDERS ---
const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { users } = useAppContext();
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [isAuthReady, setIsAuthReady] = useState(false);

    const logout = useCallback(() => {
        setCurrentUser(null);
        localStorage.removeItem('currentUser');
    }, []);

    const login = useCallback(async (id: string, pass: string): Promise<User | null> => {
        const user = users.find(u => u.id.toLowerCase() === id.toLowerCase() && u.password === pass);
        if (user) {
            if (user.status === 'pending_approval') {
                throw new Error("Your account is pending administrator approval.");
            }
            setCurrentUser(user);
            localStorage.setItem('currentUser', JSON.stringify(user));
            return user;
        }
        return null;
    }, [users]);

    useEffect(() => {
        let userFound = false;
        try {
            const storedUserStr = localStorage.getItem('currentUser');
            if (storedUserStr) {
                const storedUser = JSON.parse(storedUserStr);
                // Verify the stored user still exists in our user list
                if (users.some(u => u.id === storedUser.id)) {
                    setCurrentUser(storedUser);
                    userFound = true;
                } else {
                    // Stored user is invalid, clear storage
                    localStorage.removeItem('currentUser');
                }
            }
        } catch (error) {
            console.error("Failed to parse user from localStorage", error);
            localStorage.removeItem('currentUser');
        }

        // If no valid user was found in storage, auto-login admin
        if (!userFound) {
            const adminUser = users.find(u => u.id === 'admin');
            if (adminUser) {
                setCurrentUser(adminUser);
                localStorage.setItem('currentUser', JSON.stringify(adminUser));
            }
        }

        setIsAuthReady(true);
    }, [users]);

    // Bug Fix: Effect to log out user if they are deleted by an admin elsewhere
    useEffect(() => {
        if (currentUser && !users.find(u => u.id === currentUser.id)) {
            logout();
        }
    }, [currentUser, users, logout]);


    if (!isAuthReady) {
        return <div className="loading-fullscreen">Authenticating...</div>;
    }

    return (
        <AuthContext.Provider value={{ currentUser, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
};

const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [notifications, setNotifications] = useState<Notification[]>([]);

    const addNotification = (message: string, type: NotificationType = 'info') => {
        const id = Date.now();
        setNotifications(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setNotifications(all => all.filter(n => n.id !== id));
        }, 5000);
    };

    const dismissNotification = (id: number) => {
        setNotifications(all => all.filter(n => n.id !== id));
    };

    return (
        <NotificationContext.Provider value={{ addNotification }}>
            {children}
            <div className="notification-container">
                {notifications.map(n => (
                    <div key={n.id} className={`notification-item ${n.type}`}>
                        <span className="notification-message">{n.message}</span>
                        <button onClick={() => dismissNotification(n.id)} className="notification-dismiss">&times;</button>
                    </div>
                ))}
            </div>
        </NotificationContext.Provider>
    );
};


// --- UI COMPONENTS ---

const AIChat = ({ view }: { view: AppView }) => {
    const { currentUser } = useAuth();
    const appActions = useAppContext();
    const { addNotification } = useNotifications();
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);

    const chatHistoryRef = useRef<HTMLDivElement>(null);
    const recognitionRef = useRef<any>(null);

    const isAdmin = currentUser?.role === 'admin';

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const isSpeechSupported = !!SpeechRecognition && !!window.speechSynthesis;

    const availableTools = useMemo(() => {
        if (!isAdmin) return {};

        const functions = {
            postAnnouncement: (args: { title: string, content: string, targetRole: 'all' | 'student' | 'faculty', targetDept: 'all' | 'CSE' | 'ECE' | 'EEE' }) => {
                const result = appActions.addAnnouncement({ author: currentUser?.name || 'Admin', ...args });
                addNotification(`Announcement "${result.title}" posted.`, 'success');
                return result;
            },
            deleteAnnouncement: (args: { id: string }) => {
                const result = appActions.deleteAnnouncement(args.id);
                addNotification(`Announcement (ID: ${args.id}) deleted.`, 'info');
                return result;
            },
            approveUser: (args: { userId: string }) => {
                const result = appActions.updateUserStatus(args.userId, 'active');
                if (result) {
                    addNotification(`User '${result.name}' has been approved.`, 'success');
                }
                return result || { success: false, message: "User not found." };
            },
            rejectUser: (args: { userId: string }) => {
                const result = appActions.deleteUser(args.userId);
                if (result.success) {
                    addNotification(`User (ID: ${args.userId}) has been rejected and removed.`, 'info');
                }
                return result;
            }
        };

        const toolConfig = {
            tools: [
                { googleSearch: {} },
                {
                    functionDeclarations: [
                        {
                            name: 'postAnnouncement',
                            description: 'Creates and posts a new announcement.',
                            parameters: {
                                type: Type.OBJECT, properties: {
                                    title: { type: Type.STRING, description: 'The title of the announcement.' },
                                    content: { type: Type.STRING, description: 'The main body/content of the announcement.' },
                                    targetRole: { type: Type.STRING, enum: ['all', 'student', 'faculty'], description: "The role to target. Defaults to 'all'." },
                                    targetDept: { type: Type.STRING, enum: ['all', 'CSE', 'ECE', 'EEE'], description: "The department to target. Defaults to 'all'." }
                                }, required: ['title', 'content']
                            }
                        },
                        {
                            name: 'deleteAnnouncement',
                            description: 'Deletes an existing announcement by its ID.',
                            parameters: {
                                type: Type.OBJECT, properties: { id: { type: Type.STRING, description: 'The unique ID of the announcement to delete.' } }, required: ['id']
                            }
                        },
                         {
                            name: 'approveUser',
                            description: 'Approves a user with "pending_approval" status, making their account active.',
                            parameters: {
                                type: Type.OBJECT, properties: { userId: { type: Type.STRING, description: 'The ID of the user to approve.' } }, required: ['userId']
                            }
                        },
                        {
                            name: 'rejectUser',
                            description: 'Rejects a user with "pending_approval" status, deleting them from the system.',
                            parameters: {
                                type: Type.OBJECT, properties: { userId: { type: Type.STRING, description: 'The ID of the user to reject and delete.' } }, required: ['userId']
                            }
                        },
                    ]
                }
            ]
        };
        return { functions, toolConfig };
    }, [isAdmin, appActions, currentUser?.name, addNotification]);


    const speak = useCallback((text: string) => {
        if (!isVoiceEnabled || !window.speechSynthesis) return;

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.onstart = () => setIsSpeaking(true);
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
    }, [isVoiceEnabled]);

    useEffect(() => {
        setIsOpen(false);
        window.speechSynthesis?.cancel();
    }, [view]);

    useEffect(() => {
        if (isOpen) {
            if (messages.length === 0 && currentUser) {
                const getGreeting = () => {
                    const hour = new Date().getHours();
                    if (hour < 12) return "Good morning";
                    if (hour < 18) return "Good afternoon";
                    return "Good evening";
                };
                 const greeting = isAdmin 
                    ? `${getGreeting()}, Sir/Madam. How may I assist?`
                    : `${getGreeting()}, ${currentUser.name}! How can I assist you today?`;
                setMessages([{ id: 'init', role: 'model', text: greeting }]);
                speak(greeting);
            }
        } else {
            window.speechSynthesis?.cancel();
        }
    }, [isOpen, currentUser, messages.length, speak, isAdmin]);

    useEffect(() => {
        chatHistoryRef.current?.scrollTo(0, chatHistoryRef.current.scrollHeight);
    }, [messages]);

    const handleSend = async (messageText?: string) => {
        const textToSend = (messageText || input).trim();
        if (!textToSend || isLoading || !ai) return;

        window.speechSynthesis.cancel();

        const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: 'user', text: textToSend };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);

        const regularSystemInstruction = `You are an AI assistant for an academic management app. Your user is a ${currentUser?.role}. Be helpful, concise, and professional. Do not invent data. If you don't know, say you don't have access to that information. Format your responses in simple Markdown.`;
        const adminSystemInstruction = `You are an AI assistant for the administrator of 'AcademiaAI', acting as a personal secretary. Your responses must be extremely short and crisp. Be direct and concise. When executing a task, confirm completion with minimal words (e.g., "Done.", "Announcement posted.", "User approved."). For queries, provide answers without conversational filler. You have access to tools to control the application and Google Search for real-time information. When using Google Search, you must cite your sources.`;

        const history = messages
            .filter(m => !m.isError && m.id !== 'init')
            .map(m => ({
                role: m.role,
                parts: [
                    m.role === 'tool'
                        ? { functionResponse: { name: m.text, response: m.toolResult } }
                        : { text: m.text }
                ],
            }));
        history.push({ role: 'user', parts: [{ text: textToSend }] });

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: history as any,
                config: {
                    systemInstruction: isAdmin ? adminSystemInstruction : regularSystemInstruction,
                },
                ...availableTools.toolConfig,
            });

            const functionCall = response.candidates?.[0].content?.parts?.[0]?.functionCall;
            const groundingMetadata = response.candidates?.[0]?.groundingMetadata;

            if (functionCall && availableTools.functions) {
                const { name, args } = functionCall;
                const fn = (availableTools.functions as any)[name];
                if (fn) {
                    const result = await fn(args);
                    const toolMessage: ChatMessage = {
                        id: `tool-${Date.now()}`,
                        role: 'tool',
                        text: name,
                        toolResult: result,
                    };
                    setMessages(prev => [...prev, toolMessage]);

                    const historyWithToolResponse = [...history, { role: 'model', parts: [{ functionCall }] }, { role: 'tool', parts: [{ functionResponse: { name, response: result } }] }];

                    const finalResponse = await ai.models.generateContent({
                        model: 'gemini-2.5-flash',
                        contents: historyWithToolResponse as any,
                        config: {
                            systemInstruction: isAdmin ? adminSystemInstruction : regularSystemInstruction,
                        },
                         ...availableTools.toolConfig,
                    });

                    const modelMessage: ChatMessage = { id: `model-${Date.now()}`, role: 'model', text: finalResponse.text };
                    setMessages(prev => [...prev, modelMessage]);
                    speak(finalResponse.text);

                } else {
                     throw new Error(`Tool ${name} not found.`);
                }
            } else {
                 const modelMessage: ChatMessage = {
                    id: `model-${Date.now()}`,
                    role: 'model',
                    text: response.text,
                    sources: groundingMetadata?.groundingChunks as GroundingChunk[],
                };
                setMessages(prev => [...prev, modelMessage]);
                speak(response.text);
            }

        } catch (error) {
            console.error("AI chat error:", error);
            const errorText = "Sorry, I encountered an error. Please try again.";
            const errorMessage: ChatMessage = { id: `err-${Date.now()}`, role: 'model', text: errorText, isError: true };
            setMessages(prev => [...prev, errorMessage]);
            speak(errorText);
        } finally {
            setIsLoading(false);
        }
    };

    const handleToggleListen = () => {
        if (isListening) {
            recognitionRef.current?.stop();
            return;
        }
        
        if (!isSpeechSupported) return;

        window.speechSynthesis.cancel();

        recognitionRef.current = new SpeechRecognition();
        const recognition = recognitionRef.current;
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
            setIsListening(true);
            setInput('');
        };
        recognition.onerror = (event: any) => {
            console.error('Speech recognition error:', event.error);
        };
        recognition.onend = () => {
            setIsListening(false);
            recognitionRef.current = null;
        };

        recognition.onresult = (event: any) => {
            const transcript = event.results[0][0].transcript.trim();
            if (transcript) {
                setInput(transcript);
                handleSend(transcript);
            }
        };
        
        recognition.start();
    };

    if (!ai) return null;

    return (
        <>
            <button className="fab" onClick={() => setIsOpen(!isOpen)} aria-label="Toggle AI Assistant">
                {isOpen ? <Icons.close /> : <Icons.ai />}
            </button>
            <div className={`chat-modal ${isOpen ? 'visible' : ''}`}>
                <div className="chat-header">
                    <Icons.ai /> Academic Assistant
                </div>
                <div className="chat-history" ref={chatHistoryRef}>
                    {messages.filter(m => m.role !== 'tool').map(msg => (
                        <div key={msg.id} className={`chat-message ${msg.role}`}>
                            <div className={`message-bubble-wrapper ${msg.role}`}>
                                <div className={`message-bubble ${msg.role} ${msg.isError ? 'error' : ''}`}
                                    dangerouslySetInnerHTML={{ __html: marked.parse(msg.text) }}>
                                </div>
                                {msg.sources && msg.sources.length > 0 && (
                                    <div className="message-sources">
                                        <strong>Sources:</strong>
                                        <ul>
                                            {msg.sources.map((source, index) => (
                                                source.web?.uri && <li key={index}><a href={source.web.uri} target="_blank" rel="noopener noreferrer">{source.web.title || source.web.uri}</a></li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                    {isLoading && (
                        <div className="chat-message model">
                             <div className="message-bubble-wrapper model">
                                <div className="message-bubble model">
                                    <span className="blinking-cursor">...</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
                <div className="chat-input-area">
                    <textarea
                        className="chat-input"
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                        placeholder={isListening ? "Listening..." : "Ask me anything..."}
                        disabled={isLoading}
                    />
                     {isSpeechSupported && (
                        <>
                         <button 
                            className={`voice-toggle-button ${isVoiceEnabled ? 'on' : 'off'}`}
                            onClick={() => setIsVoiceEnabled(p => !p)}
                            disabled={isLoading}
                            title={isVoiceEnabled ? 'Mute Voice' : 'Unmute Voice'}
                            type="button"
                        >
                            {isVoiceEnabled ? <Icons.volumeOn /> : <Icons.volumeOff />}
                         </button>
                         <button 
                            className={`voice-button ${isListening ? 'listening' : ''}`}
                            onClick={handleToggleListen}
                            disabled={isLoading || isSpeaking}
                            title={isListening ? 'Stop Listening' : 'Use Voice'}
                            type="button"
                        >
                            <Icons.mic />
                        </button>
                        </>
                     )}
                    <button className="send-button" onClick={() => handleSend()} disabled={isLoading || !input.trim()}>
                        <Icons.send />
                    </button>
                </div>
            </div>
        </>
    );
};

// --- VIEWS ---

const TimetableView = () => {
    const { timeSlots, timetableEntries } = useAppContext();
    const { currentUser } = useAuth();
    const [department, setDepartment] = useState(currentUser?.dept === 'all' ? 'CSE' : currentUser?.dept || 'CSE');
    const [year, setYear] = useState(currentUser?.year || 'Year 1');

    const filteredTimetable = useMemo(() => {
        const grid: (TimetableEntry | null)[][] = Array(timeSlots.length)
            .fill(0)
            .map(() => Array(days.length).fill(null));

        timetableEntries
            .filter(e => e.department === department && e.year === year)
            .forEach(entry => {
                const dayIndex = days.indexOf(entry.day);
                if (dayIndex !== -1 && entry.timeIndex < timeSlots.length) {
                    grid[entry.timeIndex][dayIndex] = entry;
                }
            });
        return grid;
    }, [department, year, timetableEntries, timeSlots, days]);

    return (
        <div className="page-content">
            <div className="timetable-header">
                <h3>Timetable</h3>
                <div className="timetable-controls">
                    <select className="form-control" value={department} onChange={e => setDepartment(e.target.value)}>
                        {departments.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <select className="form-control" value={year} onChange={e => setYear(e.target.value)}>
                        {years.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                </div>
            </div>

            <div className="timetable-grid">
                <div className="grid-header">Time</div>
                {days.map(day => <div key={day} className="grid-header">{day}</div>)}

                {timeSlots.map((slot, timeIndex) => (
                    <React.Fragment key={timeIndex}>
                        <div className="time-slot">{slot.split(' - ').join('\n')}</div>
                        {days.map((day, dayIndex) => {
                            const entry = filteredTimetable[timeIndex][dayIndex];
                            return (
                                <div key={`${day}-${timeIndex}`} className={`grid-cell ${entry?.type || ''}`}>
                                    {entry ? (
                                        <>
                                            <span className="subject">{entry.subject}</span>
                                            {entry.faculty && <span className="faculty">{entry.faculty}</span>}
                                        </>
                                    ) : (
                                        <span>-</span>
                                    )}
                                </div>
                            );
                        })}
                    </React.Fragment>
                ))}
            </div>
        </div>
    );
};

const ManageTimetableView = () => {
    const { timetableEntries, addTimetableEntry, updateTimetableEntry, deleteTimetableEntry, timeSlots } = useAppContext();
    const { addNotification } = useNotifications();

    const [formData, setFormData] = useState<ManageFormData>({
        department: 'CSE', year: 'Year 1', day: 'Monday', timeIndex: 0, subject: '', type: 'class', faculty: ''
    });
    const [editingId, setEditingId] = useState<string | null>(null);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: name === 'timeIndex' ? parseInt(value, 10) : value }));
    };

    const resetForm = () => {
        setFormData({ department: 'CSE', year: 'Year 1', day: 'Monday', timeIndex: 0, subject: '', type: 'class', faculty: '' });
        setEditingId(null);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.subject) {
            addNotification('Subject cannot be empty.', 'error');
            return;
        }

        const entryPayload = {
            ...formData,
            faculty: formData.type === 'class' ? formData.faculty : undefined
        };

        if (editingId) {
            updateTimetableEntry(editingId, entryPayload);
            addNotification('Entry updated successfully!', 'success');
        } else {
            addTimetableEntry(entryPayload);
            addNotification('Entry added successfully!', 'success');
        }
        resetForm();
    };

    const handleEdit = (entry: TimetableEntry) => {
        setFormData({
            department: entry.department,
            year: entry.year,
            day: entry.day,
            timeIndex: entry.timeIndex,
            subject: entry.subject,
            type: entry.type,
            faculty: entry.faculty || '',
        });
        setEditingId(entry.id);
    };

    return (
        <div className="page-content manage-timetable-container">
            <div className="entry-form">
                <h3>{editingId ? 'Edit Timetable Entry' : 'Add New Timetable Entry'}</h3>
                <form onSubmit={handleSubmit}>
                    <div className="form-grid">
                        <div className="control-group">
                            <label htmlFor="department">Department</label>
                            <select id="department" name="department" value={formData.department} onChange={handleInputChange} className="form-control">
                                {departments.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </div>
                        <div className="control-group">
                            <label htmlFor="year">Year</label>
                            <select id="year" name="year" value={formData.year} onChange={handleInputChange} className="form-control">
                                {years.map(y => <option key={y} value={y}>{y}</option>)}
                            </select>
                        </div>
                        <div className="control-group">
                            <label htmlFor="day">Day</label>
                            <select id="day" name="day" value={formData.day} onChange={handleInputChange} className="form-control">
                                {days.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </div>
                        <div className="control-group">
                            <label htmlFor="timeIndex">Time Slot</label>
                            <select id="timeIndex" name="timeIndex" value={formData.timeIndex} onChange={handleInputChange} className="form-control">
                                {timeSlots.map((t, i) => <option key={i} value={i}>{t}</option>)}
                            </select>
                        </div>
                        <div className="control-group">
                            <label htmlFor="type">Type</label>
                            <select id="type" name="type" value={formData.type} onChange={handleInputChange} className="form-control">
                                <option value="class">Class</option>
                                <option value="break">Break</option>
                                <option value="common">Common Hour</option>
                            </select>
                        </div>
                        <div className="control-group">
                            <label htmlFor="subject">Subject / Title</label>
                            <input type="text" id="subject" name="subject" value={formData.subject} onChange={handleInputChange} className="form-control" />
                        </div>
                        {formData.type === 'class' && (
                            <div className="control-group">
                                <label htmlFor="faculty">Faculty</label>
                                <input type="text" id="faculty" list="faculty-list" name="faculty" value={formData.faculty} onChange={handleInputChange} className="form-control" />
                                <datalist id="faculty-list">
                                    {facultyNames.map(name => <option key={name} value={name} />)}
                                </datalist>
                            </div>
                        )}
                    </div>
                    <div className="form-actions">
                        <button type="button" className="btn btn-secondary" onClick={resetForm}>Cancel</button>
                        <button type="submit" className="btn btn-primary">
                            {editingId ? <><Icons.save /> Update Entry</> : <><Icons.plus /> Add Entry</>}
                        </button>
                    </div>
                </form>
            </div>
            <div className="entry-list-container">
                <h3>Existing Entries</h3>
                <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                    <table className="entry-list-table">
                        <thead>
                            <tr>
                                <th>Dept/Year</th>
                                <th>Day/Time</th>
                                <th>Subject</th>
                                <th>Faculty</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {timetableEntries.map(entry => (
                                <tr key={entry.id}>
                                    <td>{entry.department} / {entry.year}</td>
                                    <td>{entry.day} / {timeSlots[entry.timeIndex]}</td>
                                    <td>{entry.subject}</td>
                                    <td>{entry.faculty || 'N/A'}</td>
                                    <td className="entry-actions">
                                        <button onClick={() => handleEdit(entry)} title="Edit"><Icons.edit /></button>
                                        <button onClick={() => deleteTimetableEntry(entry.id)} className="delete-btn" title="Delete"><Icons.delete /></button>
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
    const { timeSlots, updateTimeslots, announcements, addAnnouncement, deleteAnnouncement, users, updateUser, deleteUser } = useAppContext();
    const { addNotification } = useNotifications();
    const { currentUser } = useAuth();
    const [newSlot, setNewSlot] = useState("");

    const [announcementData, setAnnouncementData] = useState({
        title: '', content: '', targetRole: 'all' as 'all' | 'student' | 'faculty', targetDept: 'all' as 'all' | 'CSE' | 'ECE' | 'EEE'
    });

    const pendingUsers = users.filter(u => u.status === 'pending_approval');

    const handleApprove = (userId: string) => {
        updateUser(userId, { status: 'active' });
        addNotification('User approved.', 'success');
    }

    const handleReject = (userId: string) => {
        deleteUser(userId);
        addNotification('User rejected and removed.', 'info');
    }

    const handleAddSlot = () => {
        if (newSlot.trim()) {
            updateTimeslots([...timeSlots, newSlot]);
            setNewSlot("");
            addNotification("Time slot added.", "success");
        }
    };

    const handleRemoveSlot = (indexToRemove: number) => {
        updateTimeslots(timeSlots.filter((_, index) => index !== indexToRemove));
        addNotification("Time slot removed.", "success");
    };

    const handleAnnouncementSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!announcementData.title || !announcementData.content) {
            addNotification("Title and content are required.", "error");
            return;
        }
        addAnnouncement({ ...announcementData, author: currentUser?.name || 'Admin' });
        setAnnouncementData({ title: '', content: '', targetRole: 'all', targetDept: 'all' });
        addNotification("Announcement posted.", "success");
    };


    return (
        <div className="page-content settings-container">
            <h2>Settings</h2>

            {adminRoles.includes(currentUser?.role!) && (
                <div className="settings-card">
                    <h3>Pending User Approvals ({pendingUsers.length})</h3>
                    {pendingUsers.length > 0 ? (
                        <ul className="user-approval-list">
                            {pendingUsers.map(user => (
                                <li key={user.id} className="user-approval-item">
                                    <div className="user-approval-info">
                                        <strong>{user.name}</strong> ({user.id})
                                        <small>{user.role} - {user.dept} {user.year || ''}</small>
                                        {user.aiAssessment && <p className="ai-assessment"><strong>AI Assessment:</strong> {user.aiAssessment}</p>}
                                    </div>
                                    <div className="item-actions">
                                        <button onClick={() => handleApprove(user.id)} className="btn btn-sm btn-success">Approve</button>
                                        <button onClick={() => handleReject(user.id)} className="btn btn-sm btn-danger">Reject</button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : <p>No users are currently awaiting approval.</p>}
                </div>
            )}

            <div className="settings-card">
                <h3>Manage Time Slots</h3>
                <ul className="timeslot-list">
                    {timeSlots.map((slot, index) => (
                        <li key={index} className="timeslot-item">
                            <span>{slot}</span>
                            <div className="item-actions">
                                <button onClick={() => handleRemoveSlot(index)} className="delete-btn"><Icons.delete /></button>
                            </div>
                        </li>
                    ))}
                </ul>
                <div className="add-timeslot-form">
                    <input
                        type="text"
                        value={newSlot}
                        onChange={e => setNewSlot(e.target.value)}
                        placeholder="e.g., 05:00 - 06:00"
                        className="form-control"
                    />
                    <button onClick={handleAddSlot} className="btn btn-primary"><Icons.plus /></button>
                </div>
            </div>

            <div className="settings-card">
                <h3>Post Announcement</h3>
                <form onSubmit={handleAnnouncementSubmit} className="form-grid">
                    <div className="control-group" style={{ gridColumn: '1 / -1' }}>
                        <label>Title</label>
                        <input
                            type="text"
                            value={announcementData.title}
                            onChange={e => setAnnouncementData(p => ({ ...p, title: e.target.value }))}
                            className="form-control"
                        />
                    </div>
                    <div className="control-group" style={{ gridColumn: '1 / -1' }}>
                        <label>Content</label>
                        <textarea
                            value={announcementData.content}
                            onChange={e => setAnnouncementData(p => ({ ...p, content: e.target.value }))}
                            className="form-control"
                            rows={4}
                        ></textarea>
                    </div>
                    <div className="control-group">
                        <label>Target Role</label>
                        <select
                            value={announcementData.targetRole}
                            onChange={e => setAnnouncementData(p => ({ ...p, targetRole: e.target.value as 'all' | 'student' | 'faculty' }))}
                            className="form-control"
                        >
                            <option value="all">All</option>
                            <option value="student">Students</option>
                            <option value="faculty">Faculty</option>
                        </select>
                    </div>
                    <div className="control-group">
                        <label>Target Department</label>
                        <select
                            value={announcementData.targetDept}
                            onChange={e => setAnnouncementData(p => ({ ...p, targetDept: e.target.value as 'all' | 'CSE' | 'ECE' | 'EEE' }))}
                            className="form-control"
                        >
                            <option value="all">All</option>
                            {departments.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                    </div>
                    <div className="form-actions" style={{ gridColumn: '1 / -1' }}>
                        <button className="btn btn-primary">Post Announcement</button>
                    </div>
                </form>
            </div>
             <div className="settings-card">
                <h3>Manage Announcements</h3>
                <ul className="announcements-manage-list">
                    {announcements.slice(0, 5).map(ann => (
                        <li key={ann.id} className="announcement-manage-item">
                           <div className="ann-manage-info">
                             <span className="ann-manage-title">{ann.title}</span>
                             <div className="ann-manage-meta">
                               <span>By {ann.author}</span>
                               <div className="ann-manage-targets">
                                <span className="target-pill">{ann.targetRole}</span>
                                <span className="target-pill">{ann.targetDept}</span>
                               </div>
                             </div>
                           </div>
                           <div className="item-actions">
                             <button onClick={() => deleteAnnouncement(ann.id)} className="delete-btn"><Icons.delete/></button>
                           </div>
                        </li>
                    ))}
                </ul>
             </div>
        </div>
    );
};

const AnnouncementsView = () => {
    const { announcements } = useAppContext();
    const { currentUser } = useAuth();

    const filteredAnnouncements = useMemo(() => {
        if (!currentUser) return [];
        return announcements.filter(ann =>
            (ann.targetRole === 'all' || ann.targetRole === currentUser.role) &&
            (ann.targetDept === 'all' || ann.targetDept === currentUser.dept)
        ).sort((a, b) => b.timestamp - a.timestamp);
    }, [announcements, currentUser]);

    return (
        <div className="page-content announcements-view-container">
            <h2>Announcements</h2>
            <ul className="announcement-list">
                {filteredAnnouncements.length > 0 ? filteredAnnouncements.map(ann => (
                    <li key={ann.id} className="announcement-list-item">
                        <div className="announcement-item-header">
                            <h3>{ann.title}</h3>
                            <div className="announcement-item-meta">
                                <span>By <strong>{ann.author}</strong></span>
                                <span>{new Date(ann.timestamp).toLocaleString()}</span>
                            </div>
                        </div>
                        <p className="announcement-item-content">{ann.content}</p>
                    </li>
                )) : <p>No announcements available.</p>}
            </ul>
        </div>
    );
};

const HomeView = () => {
    const { currentUser } = useAuth();
    const { announcements, timetableEntries } = useAppContext();
    const setView = useContext(ViewContext);

    const latestAnnouncement = announcements[0];
    const totalPeriods = timetableEntries.length;
    const totalFaculty = facultyNames.length;

    return (
        <div className="page-content home-view-container">
            <div className="home-header">
                <h1>Welcome back, {currentUser?.name}!</h1>
                <p>Here's a quick overview of your academic environment.</p>
            </div>

            <div className="kpi-grid">
                <div className="kpi-card">
                    <span className="kpi-value">{totalPeriods}</span>
                    <span className="kpi-label">Total Scheduled Periods</span>
                </div>
                <div className="kpi-card">
                    <span className="kpi-value">{totalFaculty}</span>
                    <span className="kpi-label">Registered Faculty</span>
                </div>
                <div className="kpi-card">
                    <span className="kpi-value">{departments.length}</span>
                    <span className="kpi-label">Departments</span>
                </div>
                <div className="kpi-card">
                    <span className="kpi-value">{announcements.length}</span>
                    <span className="kpi-label">Total Announcements</span>
                </div>
            </div>

            <h3>Quick Actions</h3>
            <div className="quick-actions-grid">
                <div className="action-card" onClick={() => setView('timetable')}>
                    <Icons.timetable />
                    <span>View Timetable</span>
                </div>
                 {adminRoles.includes(currentUser?.role!) && (
                    <div className="action-card" onClick={() => setView('manage')}>
                        <Icons.manage />
                        <span>Manage Timetable</span>
                    </div>
                )}
                <div className="action-card" onClick={() => setView('announcements')}>
                    <Icons.announcements />
                    <span>View Announcements</span>
                </div>
                 {privilegedRoles.includes(currentUser?.role!) && (
                     <div className="action-card" onClick={() => setView('studentDirectory')}>
                        <Icons.students />
                        <span>Student Directory</span>
                    </div>
                )}
            </div>

            {latestAnnouncement && (
                 <div className="latest-announcement-card">
                     <h3>Latest Announcement</h3>
                     <h4>{latestAnnouncement.title}</h4>
                     <p>{latestAnnouncement.content.substring(0, 150)}...</p>
                 </div>
            )}
        </div>
    );
};

const DashboardView = () => {
    const { currentUser } = useAuth();
    const { timeSlots, timetableEntries, leaveRequests, resourceRequests, attendance, users } = useAppContext();
    const [currentDay] = useState(days[new Date().getDay() - 1] || 'Monday');

    const todaysSchedule = useMemo(() => {
        return timetableEntries
            .filter(e =>
                e.day === currentDay &&
                e.department === currentUser?.dept &&
                e.year === currentUser?.year
            )
            .sort((a, b) => a.timeIndex - b.timeIndex);
    }, [timetableEntries, currentDay, currentUser]);

    const facultySchedule = useMemo(() => {
        if (!privilegedRoles.includes(currentUser?.role!)) return [];
        return timetableEntries
            .filter(e => e.faculty === currentUser?.name && e.day === currentDay)
            .sort((a, b) => a.timeIndex - b.timeIndex);
    }, [timetableEntries, currentDay, currentUser]);

    const facultyWeeklySchedule = useMemo(() => {
        if (!privilegedRoles.includes(currentUser?.role!)) return {};
        const schedule: Record<string, TimetableEntry[]> = {};
        days.forEach(day => {
            schedule[day] = timetableEntries
                .filter(e => e.faculty === currentUser?.name && e.day === day)
                .sort((a, b) => a.timeIndex - b.timeIndex);
        });
        return schedule;
    }, [timetableEntries, currentUser]);
    
    const workloadData = useMemo(() => {
        if (!adminRoles.includes(currentUser?.role!)) return [];
        const counts = facultyNames.reduce((acc, name) => {
            acc[name] = 0;
            return acc;
        }, {} as Record<string, number>);

        timetableEntries.forEach(entry => {
            if (entry.faculty && counts.hasOwnProperty(entry.faculty)) {
                counts[entry.faculty]++;
            }
        });
        const max = Math.max(...Object.values(counts));
        return Object.entries(counts).map(([name, count]) => ({
            name,
            count,
            percentage: max > 0 ? (count / max) * 100 : 0
        })).sort((a, b) => b.count - a.count);
    }, [timetableEntries, currentUser]);


    // Student View
    if (currentUser?.role === 'student') {
        const studentAttendance = attendance[currentUser.id];
        return (
            <div className="page-content dashboard-student">
                <div className="current-date-display">{new Date().toDateString()}</div>
                <div className="dashboard-grid">
                    <div className="dashboard-card">
                        <h3>Today's Schedule ({currentDay})</h3>
                        <ul className="schedule-list">
                            {todaysSchedule.length > 0 ? todaysSchedule.map(s => (
                                <li key={s.id} className={`schedule-item ${s.type}`}>
                                    <span className="time">{timeSlots[s.timeIndex]}</span>
                                    <span className="subject">{s.subject}</span>
                                    <span className="faculty">{s.faculty}</span>
                                </li>
                            )) : <p>No classes scheduled for today.</p>}
                        </ul>
                    </div>
                    <div className="dashboard-card">
                        <h3>Weekly Attendance</h3>
                        {studentAttendance ? (
                            <>
                                <div className="attendance-grid">
                                    {days.map(day => (
                                        <div key={day} className="attendance-day">
                                            <div className={`attendance-status ${studentAttendance.records[day] || ''}`}></div>
                                            <span className="attendance-day-label">{day.substring(0, 3)}</span>
                                        </div>
                                    ))}
                                </div>
                                <div className="attendance-legend">
                                    <div className="legend-item"><span className="legend-dot present"></span> Present</div>
                                    <div className="legend-item"><span className="legend-dot late"></span> Late</div>
                                    <div className="legend-item"><span className="legend-dot absent"></span> Absent</div>
                                </div>
                            </>
                        ) : <p>No attendance data available.</p>}
                    </div>
                    <div className="dashboard-card">
                         <h3>Request Resources</h3>
                         <p style={{fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1rem'}}>Need equipment for a project? Submit a request here.</p>
                         <textarea className="form-control" rows={2} placeholder="e.g., Requesting a multimeter from the EEE lab..."></textarea>
                         <button className="btn btn-primary" style={{marginTop: '1rem', alignSelf: 'flex-start'}}>Submit Request</button>

                         <div className="request-history-container">
                            <h4>Your Recent Requests</h4>
                             <ul className="resource-request-list">
                                {resourceRequests.filter(r => r.userId === currentUser.id).length > 0 ? resourceRequests.filter(r => r.userId === currentUser.id).map(req => (
                                <li key={req.id} className="resource-request-item">
                                    <div className="request-details">
                                        <span className="request-text" title={req.requestText}>{req.requestText}</span>
                                        <span className="request-timestamp">{new Date(req.timestamp).toLocaleDateString()}</span>
                                    </div>
                                    <span className={`status-pill ${req.status}`}>{req.status}</span>
                                </li>
                                )) : <p className="no-history-text">No request history.</p>}
                             </ul>
                         </div>
                    </div>
                </div>
            </div>
        );
    }
    
    // Faculty/Advisor View
    if (currentUser?.role === 'faculty' || currentUser?.role === 'class advisor') {
        return (
            <div className="page-content dashboard-faculty">
                 <div className="current-date-display">{new Date().toDateString()}</div>
                <div className="dashboard-grid">
                    <div className="dashboard-card">
                        <h3>Today's Schedule ({currentDay})</h3>
                        <ul className="schedule-list">
                            {facultySchedule.length > 0 ? facultySchedule.map(s => (
                                <li key={s.id} className={`schedule-item ${s.type}`}>
                                    <span className="time">{timeSlots[s.timeIndex]}</span>
                                    <span className="subject">{s.subject} ({s.department} {s.year})</span>
                                </li>
                            )) : <p>No classes scheduled for today.</p>}
                        </ul>
                    </div>
                     <div className="dashboard-card">
                         <h3>Pending Leave Requests</h3>
                         <ul className="leave-approval-list">
                            {leaveRequests.filter(r => r.status === 'pending').length > 0 ? leaveRequests.filter(r => r.status === 'pending').map(req => (
                                 <li key={req.id}>
                                     <div className="req-info">
                                         <strong>{req.facultyName}</strong>
                                         <small>{req.day} at {timeSlots[req.timeIndex]}</small>
                                     </div>
                                 </li>
                             )) : <p>No pending requests.</p>}
                         </ul>
                     </div>
                     <div id="weekly-faculty-view" className="dashboard-card">
                         <h3>Your Weekly View</h3>
                         <div className="weekly-view-grid">
                             {days.map(day => (
                                 <div key={day} className="weekly-day-column">
                                     <div className="weekly-day-header">{day}</div>
                                     <div className="weekly-day-classes">
                                         {facultyWeeklySchedule[day]?.map(item => (
                                             <div key={item.id} className="weekly-class-item">
                                                 <span className="class-time">{timeSlots[item.timeIndex]}</span>
                                                 <span className="class-subject" title={item.subject}>{item.subject}</span>
                                                 <span className="class-info">{item.department} / {item.year}</span>
                                             </div>
                                         ))}
                                     </div>
                                 </div>
                             ))}
                         </div>
                     </div>
                </div>
            </div>
        )
    }

    // HOD/Admin View
    if (adminRoles.includes(currentUser?.role!)) {
        const recentActivity = [...leaveRequests, ...resourceRequests].sort((a,b) => b.timestamp - a.timestamp).slice(0, 5);

        return (
            <div className="page-content dashboard-admin">
                 <div className="current-date-display">{new Date().toDateString()}</div>
                 <div className="dashboard-grid">
                     <div className="dashboard-card">
                         <h3>Pending Approvals</h3>
                          <ul className="leave-approval-list">
                              {leaveRequests.filter(r => r.status === 'pending').map(req => (
                                 <li key={req.id}>
                                    <div className="req-info">
                                         <strong>Leave: {req.facultyName}</strong>
                                         <small>{req.day}, {timeSlots[req.timeIndex]}</small>
                                     </div>
                                      <span className="status-pill pending">Pending</span>
                                 </li>
                             ))}
                              {resourceRequests.filter(r => r.status === 'pending').map(req => (
                                 <li key={req.id}>
                                     <div className="req-info">
                                         <strong>Resource: {req.userName}</strong>
                                         <small title={req.requestText}>{req.requestText.substring(0,30)}...</small>
                                     </div>
                                     <span className="status-pill pending">Pending</span>
                                 </li>
                             ))}
                          </ul>
                          {leaveRequests.filter(r => r.status === 'pending').length === 0 && resourceRequests.filter(r => r.status === 'pending').length === 0 && <p>No pending approvals.</p>}
                     </div>
                     <div className="dashboard-card">
                        <h3>Recent Activity</h3>
                        <ul className="activity-feed-list">
                            {recentActivity.map(item => (
                                <li key={item.id} className="activity-feed-item">
                                    <div className={`activity-icon ${item.status}`}>
                                        {item.status === 'approved' ? <Icons.checkCircle /> : <Icons.xCircle />}
                                    </div>
                                    <div className="activity-details">
                                        <p>
                                           <strong>{'facultyName' in item ? item.facultyName : item.userName}</strong>'s request was {item.status}.
                                        </p>
                                        <small>{new Date(item.timestamp).toLocaleString()}</small>
                                    </div>
                                </li>
                            ))}
                        </ul>
                     </div>
                      <div className="dashboard-card" style={{gridColumn: '1 / -1'}}>
                         <h3>Faculty Workload Overview</h3>
                         <div className="workload-chart-container">
                            <ul className="workload-list">
                               {workloadData.map(d => (
                                <li key={d.name} className="workload-item">
                                    <span className="faculty-name">{d.name}</span>
                                    <div className="workload-bar">
                                        <div className="bar-fill" style={{ width: `${d.percentage}%` }}>
                                            <span>{d.count} hrs/wk</span>
                                        </div>
                                    </div>
                                </li>
                               ))}
                            </ul>
                         </div>
                      </div>
                 </div>
            </div>
        )
    }

    return <div className="page-content">Dashboard not available for your role.</div>
};

const StudentDirectoryView = () => {
    const { users } = useAppContext();
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedStudent, setSelectedStudent] = useState<User | null>(null);

    const students = users.filter(u => u.role === 'student');

    const filteredStudents = students.filter(s => 
        s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.id.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="page-content student-directory-container">
            <div className="directory-header">
                <h2>Student Directory</h2>
                <div className="directory-controls">
                    <input 
                        type="text" 
                        placeholder="Search by name or ID..."
                        className="form-control"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>
            <div className="student-list">
                {filteredStudents.map(student => (
                    <div key={student.id} className="student-list-item" onClick={() => setSelectedStudent(student)}>
                        <div className="student-info">
                            <span className="student-name">{student.name}</span>
                            <span className="student-id">{student.id}</span>
                        </div>
                        <div className="student-details">
                            <span>{student.dept}</span>
                            <span>{student.year}</span>
                        </div>
                    </div>
                ))}
            </div>
            {selectedStudent && <StudentProfileModal student={selectedStudent} onClose={() => setSelectedStudent(null)} />}
        </div>
    );
};

const StudentProfileModal = ({ student, onClose }: { student: User; onClose: () => void; }) => {
    const { attendance, summaries, resourceRequests } = useAppContext();
    const studentAttendance = attendance[student.id];
    const studentSummary = summaries[student.id];
    const studentRequests = resourceRequests.filter(r => r.userId === student.id);

    return (
        <div className="modal-overlay open student-profile-modal-overlay">
            <div className="modal-content student-profile-modal">
                <div className="student-profile-header">
                    <div>
                        <h3>{student.name}</h3>
                        <p style={{ color: 'var(--text-secondary)', marginTop: '-0.75rem' }}>{student.id}</p>
                    </div>
                    <button onClick={onClose} className="close-modal-btn">&times;</button>
                </div>

                <div className="student-profile-grid">
                    <div className="profile-section">
                        <h4>Details</h4>
                        <p><strong>Department:</strong> {student.dept}</p>
                        <p><strong>Year:</strong> {student.year}</p>
                        <p><strong>Role:</strong> {student.role}</p>
                        <p><strong>Status:</strong> <span style={{ textTransform: 'capitalize' }}>{student.status}</span></p>
                    </div>

                    <div className="profile-section">
                        <h4>Attendance Overview</h4>
                        {studentAttendance ? (
                            <div className="attendance-grid-modal">
                                {days.map(day => (
                                    <div key={day} className="attendance-day-modal">
                                        <div className={`attendance-status-modal ${studentAttendance.records[day] || ''}`}></div>
                                        <span className="attendance-day-label-modal">{day.substring(0, 3)}</span>
                                    </div>
                                ))}
                            </div>
                        ) : <p>No attendance data available.</p>}
                    </div>

                    <div className="profile-section request-history-section">
                        <h4>Resource Requests</h4>
                         <ul className="resource-request-list">
                            {studentRequests.length > 0 ? studentRequests.map(req => (
                            <li key={req.id} className="resource-request-item">
                                <div className="request-details">
                                    <span className="request-text" title={req.requestText}>{req.requestText}</span>
                                    <span className="request-timestamp">{new Date(req.timestamp).toLocaleDateString()}</span>
                                </div>
                                <span className={`status-pill ${req.status}`}>{req.status}</span>
                            </li>
                            )) : <p className="no-history-text">No requests made.</p>}
                         </ul>
                    </div>

                    <div className="profile-section ai-summary-section">
                        <h4>AI Generated Summary</h4>
                        <div className="ai-summary-container">
                             {studentSummary ? (
                                <p>{studentSummary.summary}</p>
                             ) : (
                                <p>No AI summary has been generated for this student yet.</p>
                             )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const AuthView = () => {
    const { login } = useAuth();
    const { addUser, users } = useAppContext();
    const { addNotification } = useNotifications();

    const [isLogin, setIsLogin] = useState(true);
    const [error, setError] = useState('');
    const [formData, setFormData] = useState({ id: '', password: '', name: '', role: 'student' as UserRole, dept: 'CSE', year: 'Year 1' });
    const [isLoading, setIsLoading] = useState(false);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setFormData(p => ({ ...p, [e.target.name]: e.target.value }));
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            if (isLogin) {
                if (!formData.id || !formData.password) {
                    setError("Username and password are required.");
                    return;
                }
                const user = await login(formData.id, formData.password);
                if (!user) {
                    setError("Invalid credentials.");
                }
            } else { // Sign up
                if (!formData.id || !formData.password || !formData.name) {
                    setError("Username, password, and name are required.");
                    return;
                }
                if (users.some(u => u.id.toLowerCase() === formData.id.toLowerCase())) {
                    setError("Username already exists.");
                    return;
                }
                
                const newUser: User = {
                    id: formData.id,
                    name: formData.name,
                    password: formData.password,
                    role: formData.role,
                    dept: formData.dept,
                    year: formData.role === 'student' ? formData.year : undefined,
                    status: 'pending_approval' // All new users need approval
                };

                if (ai) {
                     try {
                        const prompt = `Assess this new user signup for an academic management app. Based on their role and department, is this a typical and reasonable registration? Provide a one-sentence assessment. User Details: Name: ${newUser.name}, Role: ${newUser.role}, Department: ${newUser.dept}, Year: ${newUser.year || 'N/A'}.`;
                        const result = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
                        newUser.aiAssessment = result.text;
                     } catch(aiError) {
                        console.error("AI assessment failed:", aiError);
                        newUser.aiAssessment = "AI assessment could not be performed.";
                     }
                }

                addUser(newUser);
                addNotification("Registration successful! Your account is pending approval.", "success");
                setIsLogin(true); // Switch to login view
            }
        } catch (err: any) {
            setError(err.message || 'An unexpected error occurred.');
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <div className="login-view-container">
            <div className="login-card">
                <div className="login-header">
                    <div className="logo"><Icons.logo /></div>
                    <h1>{isLogin ? 'Welcome Back' : 'Create Account'}</h1>
                </div>
                <form onSubmit={handleSubmit} className={isLogin ? '' : 'signup-form'}>
                    {error && <div className="auth-error">{error}</div>}

                    {!isLogin && (
                        <>
                           <div className="control-group">
                             <label>Full Name</label>
                             <input type="text" name="name" value={formData.name} onChange={handleInputChange} className="form-control" />
                           </div>
                           <div className="control-group">
                               <label>Role</label>
                               <select name="role" value={formData.role} onChange={handleInputChange} className="form-control">
                                   <option value="student">Student</option>
                                   <option value="faculty">Faculty</option>
                               </select>
                           </div>
                           <div className="control-group">
                               <label>Department</label>
                               <select name="dept" value={formData.dept} onChange={handleInputChange} className="form-control">
                                   {departments.map(d => <option key={d} value={d}>{d}</option>)}
                               </select>
                           </div>
                            {formData.role === 'student' && (
                                <div className="control-group">
                                    <label>Year</label>
                                    <select name="year" value={formData.year} onChange={handleInputChange} className="form-control">
                                        {years.map(y => <option key={y} value={y}>{y}</option>)}
                                    </select>
                                </div>
                            )}
                        </>
                    )}

                    <div className="control-group">
                        <label>Username / ID</label>
                        <input type="text" name="id" value={formData.id} onChange={handleInputChange} className="form-control" />
                    </div>
                    <div className="control-group">
                        <label>Password</label>
                        <input type="password" name="password" value={formData.password} onChange={handleInputChange} className="form-control" />
                    </div>
                    
                    <button type="submit" className="btn btn-primary" style={{width: '100%', marginTop: '0.5rem'}} disabled={isLoading}>
                        {isLoading ? 'Processing...' : (isLogin ? 'Login' : 'Sign Up')}
                    </button>
                    
                    <div className="auth-toggle">
                        {isLogin ? "Don't have an account?" : "Already have an account?"}
                        <button type="button" onClick={() => { setIsLogin(!isLogin); setError('')}}>
                            {isLogin ? 'Sign Up' : 'Login'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};


const ViewContext = createContext<(view: AppView) => void>(() => {});

const App = () => {
    const [theme, setTheme] = useState('light');
    const { currentUser, logout } = useAuth();
    const [view, setView] = useState<AppView>('home');
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const { leaveRequests, resourceRequests, users } = useAppContext();

    const pendingCount = useMemo(() => {
        if (!currentUser) return 0;
        if (adminRoles.includes(currentUser.role)) {
             const userApprovals = users.filter(u => u.status === 'pending_approval').length;
             const leaveApprovals = leaveRequests.filter(r => r.status === 'pending').length;
             const resourceApprovals = resourceRequests.filter(r => r.status === 'pending').length;
             return userApprovals + leaveApprovals + resourceApprovals;
        }
        return 0;
    }, [leaveRequests, resourceRequests, users, currentUser]);
    
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
    }, [theme]);

    const toggleTheme = () => {
        setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
    };

    if (!currentUser) {
        return <AuthView />;
    }

    const renderView = () => {
        switch (view) {
            case 'home': return <HomeView />;
            case 'dashboard': return <DashboardView />;
            case 'timetable': return <TimetableView />;
            case 'manage': return <ManageTimetableView />;
            case 'settings': return <SettingsView />;
            case 'announcements': return <AnnouncementsView />;
            case 'studentDirectory': return <StudentDirectoryView />;
            default: return <HomeView />;
        }
    };
    const viewTitles: Record<AppView, string> = {
        home: 'Home',
        dashboard: 'Dashboard',
        timetable: 'Timetable',
        manage: 'Manage Timetable',
        settings: 'Settings',
        auth: 'Authentication',
        approvals: 'Approvals',
        announcements: 'Announcements',
        studentDirectory: 'Student Directory'
    };


    const navItems: { view: AppView, label: string, icon: () => JSX.Element, roles: UserRole[] | 'all' }[] = [
        { view: 'home', label: 'Home', icon: Icons.home, roles: 'all'},
        { view: 'dashboard', label: 'Dashboard', icon: Icons.dashboard, roles: 'all'},
        { view: 'timetable', label: 'Timetable', icon: Icons.timetable, roles: 'all' },
        { view: 'announcements', label: 'Announcements', icon: Icons.announcements, roles: 'all' },
        { view: 'studentDirectory', label: 'Students', icon: Icons.students, roles: privilegedRoles },
        { view: 'manage', label: 'Manage', icon: Icons.manage, roles: adminRoles },
        { view: 'settings', label: 'Settings', icon: Icons.settings, roles: adminRoles },
    ];

    const handleSetView = (newView: AppView) => {
        setView(newView);
        setIsSidebarOpen(false);
    }
    
    const availableNavItems = navItems.filter(item => item.roles === 'all' || item.roles.includes(currentUser.role));

    return (
        <ViewContext.Provider value={handleSetView}>
            <div className={`app-container ${isSidebarOpen ? 'sidebar-open' : ''}`}>
                <div className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
                    <div className="sidebar-header">
                        <div className="logo"><Icons.logo /></div>
                        <h1>AcademiaAI</h1>
                        <button className="sidebar-close" onClick={() => setIsSidebarOpen(false)}><Icons.close/></button>
                    </div>
                    <nav>
                        <ul className="nav-list">
                            {availableNavItems.map(item => (
                                <li className="nav-item" key={item.view}>
                                    <button className={view === item.view ? 'active' : ''} onClick={() => handleSetView(item.view)}>
                                        <item.icon /> {item.label}
                                        {item.view === 'settings' && pendingCount > 0 && <span className="notification-badge">{pendingCount}</span>}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </nav>
                </div>
                <div className="sidebar-overlay" onClick={() => setIsSidebarOpen(false)}></div>
                <main className="main-content">
                    <header className="header">
                         <button className="menu-toggle" onClick={() => setIsSidebarOpen(true)}><Icons.menu /></button>
                         <h2>{viewTitles[view]}</h2>
                        <div className="header-actions">
                            <span className="user-info">Logged in as <strong>{currentUser.name}</strong></span>
                            <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
                                {theme === 'light' ? <Icons.moon /> : <Icons.sun />}
                            </button>
                            <button className="btn btn-secondary" onClick={logout}>Logout</button>
                        </div>
                    </header>
                    {renderView()}
                </main>
                <AIChat view={view} />
            </div>
        </ViewContext.Provider>
    );
};


const AppWrapper = () => {
    const db = useLocalDatabase();

    if (!db.isInitialized) {
        return <div className="loading-fullscreen">Loading Database...</div>;
    }

    return (
        <AppContext.Provider value={db}>
            <NotificationProvider>
                <AuthProvider>
                    <App />
                </AuthProvider>
            </NotificationProvider>
        </AppContext.Provider>
    );
}

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<AppWrapper />);
}
