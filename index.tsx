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
    status: 'active' | 'pending_approval' | 'rejected';
    aiAssessment?: string; // For admin review
    aiSummary?: string; // For student performance summaries
}
interface ResourceRequest {
    id: string;
    userId: string;
    requestText: string;
    status: 'pending' | 'approved' | 'rejected';
    timestamp: number;
}
interface AppNotification {
    id: string;
    message: string;
    type: 'info' | 'success' | 'error';
}

const DEPARTMENTS = ["CSE", "ECE", "EEE"];
const YEARS = ["I", "II", "III", "IV"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const TIME_SLOTS_DEFAULT = [
    "9:00 - 10:00",
    "10:00 - 11:00",
    "11:00 - 11:15",
    "11:15 - 12:15",
    "12:15 - 1:15",
    "1:15 - 2:00",
    "2:00 - 3:00",
    "3:00 - 4:00"
];

const APP_VIEWS_CONFIG: Record<AppView, { title: string; icon: keyof typeof Icons; roles: UserRole[] }> = {
    home: { title: "Home", icon: "home", roles: ['student', 'faculty', 'hod', 'admin', 'class advisor'] },
    dashboard: { title: "Dashboard", icon: "dashboard", roles: ['student', 'faculty', 'hod', 'admin', 'class advisor'] },
    timetable: { title: "Timetable", icon: "timetable", roles: ['student', 'faculty', 'hod', 'admin', 'class advisor'] },
    studentDirectory: { title: "Student Directory", icon: "users", roles: ['faculty', 'hod', 'admin', 'class advisor'] },
    approvals: { title: "Approvals", icon: "approvals", roles: ['hod', 'admin'] },
    announcements: { title: "Announcements", icon: "announcement", roles: ['student', 'faculty', 'hod', 'admin', 'class advisor'] },
    manage: { title: "Manage Timetable", icon: "edit", roles: ['admin'] },
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
    logo: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"></path></svg>,
    home: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"></path></svg>,
    dashboard: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M13 21V11h8v10h-8zM3 13V3h8v10H3zm6-2V5H5v6h4zM3 21v-6h8v6H3zm2-2h4v-2H5v2zM15 5h4v4h-4V5z"></path></svg>,
    timetable: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"></path></svg>,
    approvals: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"></path></svg>,
    announcement: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm0-5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1zm0 7c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1z"></path></svg>,
    manage: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M14.06 9.02l.92.92L5.92 19H5v-.92l9.06-9.06M17.66 3c-.25 0-.51.1-.7.29l-1.83 1.83 3.75 3.75 1.83-1.83c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.2-.2-.45-.29-.71-.29zm-3.6 3.19L3 17.25V21h3.75L17.81 9.94l-3.75-3.75z"></path></svg>,
    settings: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.5.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49.42l.38-2.65c.61-.25 1.17-.59-1.69.98l2.49 1c.23.09.49 0 .61.22l2-3.46c.12-.22.07-.5-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"></path></svg>,
    logout: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"></path></svg>,
    sun: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.64 5.64c-.39-.39-1.02-.39-1.41 0-.39.39-.39 1.02 0 1.41l1.06 1.06c.39.39 1.02.39 1.41 0s.39-1.02 0-1.41L5.64 5.64zm12.72 12.72c-.39-.39-1.02-.39-1.41 0-.39.39-.39 1.02 0 1.41l1.06 1.06c.39.39 1.02.39 1.41 0s.39-1.02 0-1.41l-1.06-1.06zM5.64 18.36l-1.06-1.06c-.39-.39-.39-1.02 0-1.41s1.02-.39 1.41 0l1.06 1.06c.39.39.39 1.02 0 1.41s-1.02.39-1.41 0zM18.36 5.64l-1.06 1.06c-.39.39-.39-1.02 0 1.41s1.02.39 1.41 0l1.06-1.06c.39-.39.39-1.02 0-1.41s-1.02-.39-1.41 0z"></path></svg>,
    moon: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M10 2c-1.82 0-3.53.5-5 1.35C7.99 5.08 10 8.3 10 12s-2.01 6.92-5 8.65C6.47 21.5 8.18 22 10 22c5.52 0 10-4.48 10-10S15.52 2 10 2z"></path></svg>,
    send: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path></svg>,
    mic: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z"></path></svg>,
    micOff: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1.2-9.1c0-.66.54-1.2 1.2-1.2.66 0 1.2.54 1.2 1.2l-.01 6.2c0 .66-.53 1.2-1.19 1.2s-1.2-.54-1.2-1.2V4.9zm6.5 6.2c0 2.57-2.09 4.67-4.67 4.67A4.673 4.673 0 0 1 8 11.1H6.3c0 3.03 2.4 5.5 5.33 5.86V21h1.74v-4.04c2.93-.36 5.33-2.83 5.33-5.86h-1.7z"></path></svg>,
    volumeUp: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"></path></svg>,
    volumeOff: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"></path></svg>,
    chat: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"></path></svg>,
    close: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"></path></svg>,
    edit: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"></path></svg>,
    delete: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"></path></svg>,
    add: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"></path></svg>,
    check: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"></path></svg>,
    users: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"></path></svg>,
    login: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M11 7L9.6 8.4l2.6 2.6H2v2h10.2l-2.6 2.6L11 17l5-5-5-5zm9 12h-8v-2h8v2zm0-4h-8v-2h8v2zm0-4h-8V9h8v2zM20 3H4c-1.1 0-2 .9-2 2v2h2V5h16v14h-8v2h8c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"></path></svg>,
    refine: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.62-.12 2.37-.34l-1.42-1.42C12.64 19.88 12.33 20 12 20c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8c0 .33-.02.64-.06.95l1.42 1.42C21.88 15.62 22 14.83 22 14c0-4.97-4.03-9-9-9zm-1.15 3.85L9.4 5.4 7.94 8.25 5.1 9.7l2.85 1.46L9.4 14.01l1.46-2.85L13.7 9.7zM19.5 13.5l-1.25 2.5-2.5 1.25 2.5 1.25 1.25 2.5 1.25-2.5 2.5-1.25-2.5-1.25z"></path></svg>,
    warning: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"></path></svg>,
    retry: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path></svg>,
    cloud: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"></path></svg>,
    transport: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm12 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-8.5-6H3V6h12v6h-5.5z"></path></svg>,
    education: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3L1 9l11 6 9-4.91V17h2V9L12 3z"></path></svg>,
};


// --- MOCK DATA ---
// ... (omitted for brevity in final implementation)
// In a real app, this would be fetched from a database.
const MOCK_USERS: User[] = [
    { id: 'admin', name: 'Admin User', role: 'admin', dept: 'Admin', status: 'active' },
    { id: 'hod_cse', name: 'Dr. Evelyn Reed', role: 'hod', dept: 'CSE', status: 'active' },
    { id: 'faculty_cse_1', name: 'Prof. Alan Grant', role: 'faculty', dept: 'CSE', status: 'active' },
    { id: 'faculty_cse_2', name: 'Dr. Ian Malcolm', role: 'faculty', dept: 'CSE', status: 'active' },
    { id: 'faculty_ece_1', name: 'Prof. Ellie Sattler', role: 'faculty', dept: 'ECE', status: 'active' },
    { id: 'student_cse_1', name: 'Lex Murphy', role: 'student', dept: 'CSE', year: 'II', status: 'active' },
    { id: 'student_ece_1', name: 'Tim Murphy', role: 'student', dept: 'ECE', year: 'III', status: 'active' },
    { id: 'advisor_cse_2', name: 'Ms. Diane', role: 'class advisor', dept: 'CSE', year: 'II', status: 'active' },
    { id: 'new_faculty', name: 'Dr. Sarah Harding', role: 'faculty', dept: 'ECE', status: 'pending_approval' },
];

const MOCK_TIMETABLE_DATA: TimetableEntry[] = [
    // CSE II Year
    { id: 'cse2_mon_1', department: "CSE", year: "II", day: "Monday", timeIndex: 0, subject: "Data Structures", type: 'class', faculty: 'Prof. Alan Grant' },
    { id: 'cse2_mon_2', department: "CSE", year: "II", day: "Monday", timeIndex: 1, subject: "Algorithms", type: 'class', faculty: 'Dr. Ian Malcolm' },
    { id: 'cse2_mon_3', department: "CSE", year: "II", day: "Monday", timeIndex: 2, subject: "Break", type: 'break' },
    { id: 'cse2_mon_4', department: "CSE", year: "II", day: "Monday", timeIndex: 3, subject: "Database Systems", type: 'class', faculty: 'Prof. Alan Grant' },
    // ECE III Year
    { id: 'ece3_tue_1', department: "ECE", year: "III", day: "Tuesday", timeIndex: 0, subject: "Digital Circuits", type: 'class', faculty: 'Prof. Ellie Sattler' },
    { id: 'ece3_tue_2', department: "ECE", year: "III", day: "Tuesday", timeIndex: 1, subject: "Signal Processing", type: 'class', faculty: 'Prof. Ellie Sattler' },
];

const MOCK_ANNOUNCEMENTS: Announcement[] = [
    { id: 'ann1', title: "Mid-Term Exams Schedule", content: "The mid-term examinations for all departments will commence from the 15th of next month. Detailed schedule is available on the notice board.", author: "Admin", timestamp: Date.now() - 86400000, targetRole: 'all', targetDept: 'all' },
    { id: 'ann2', title: "Project Submission Deadline (CSE)", content: "Final year CSE students must submit their project proposals by the end of this week.", author: "HOD (CSE)", timestamp: Date.now() - 172800000, targetRole: 'student', targetDept: 'CSE' },
];

const MOCK_LEAVE_REQUESTS: LeaveRequest[] = [
    { id: 'lr1', facultyId: 'faculty_cse_1', facultyName: 'Prof. Alan Grant', timetableEntryId: 'cse2_mon_4', day: 'Monday', timeIndex: 3, status: 'pending', reason: 'Personal emergency', timestamp: Date.now() - 3600000 },
];
const MOCK_RESOURCE_REQUESTS: ResourceRequest[] = [
    { id: 'rr1', userId: 'student_cse_1', requestText: 'Requesting access to the advanced compiler design e-books for my project.', status: 'approved', timestamp: Date.now() - 86400000 * 2 },
    { id: 'rr2', userId: 'student_cse_1', requestText: 'Need lab access on Saturday for project work.', status: 'pending', timestamp: Date.now() - 3600000 * 5 },
]

// --- DATABASE SIMULATION ---
// Using React state and localStorage to simulate a persistent database
const useDatabase = <T,>(key: string, initialValue: T) => {
    const [data, setData] = useState<T>(() => {
        try {
            const item = window.localStorage.getItem(key);
            return item ? JSON.parse(item) : initialValue;
        } catch (error) {
            console.error(error);
            return initialValue;
        }
    });

    const updateData = (newData: T | ((val: T) => T)) => {
        try {
            const valueToStore = newData instanceof Function ? newData(data) : newData;
            setData(valueToStore);
            window.localStorage.setItem(key, JSON.stringify(valueToStore));
        } catch (error) {
            console.error(error);
        }
    };

    return [data, updateData] as const;
};


// --- HOOKS ---
const useLocalStorage = <T,>(key: string, initialValue: T) => {
    const [storedValue, setStoredValue] = useState<T>(() => {
        try {
            const item = window.localStorage.getItem(key);
            return item ? JSON.parse(item) : initialValue;
        } catch (error) {
            console.error(error);
            return initialValue;
        }
    });
    const setValue = (value: T | ((val: T) => T)) => {
        try {
            const valueToStore =
                value instanceof Function ? value(storedValue) : value;
            setStoredValue(valueToStore);
            window.localStorage.setItem(key, JSON.stringify(valueToStore));
        } catch (error) {
            console.error(error);
        }
    };
    return [storedValue, setValue] as const;
};

const useLocation = () => {
    const [locationData, setLocationData] = useState<{ city: string | null; country: string | null; error: string | null; }>({ city: null, country: null, error: null });
    useEffect(() => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                async (position) => {
                    try {
                        const { latitude, longitude } = position.coords;
                        // Using a free reverse geocoding API.
                        // In a real app, you might use a more robust, key-based service.
                        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`);
                        const data = await response.json();
                        setLocationData({
                            city: data.address.city || data.address.town || data.address.village,
                            country: data.address.country,
                            error: null,
                        });
                    } catch (error) {
                        setLocationData({ city: null, country: null, error: 'Failed to fetch location details.' });
                    }
                },
                (error) => {
                    setLocationData({ city: null, country: null, error: 'Geolocation permission denied.' });
                }
            );
        } else {
            setLocationData({ city: null, country: null, error: 'Geolocation is not supported by this browser.' });
        }
    }, []);
    return locationData;
};

const useLiveTime = (timeZone: string) => {
    const [time, setTime] = useState(new Date());

    useEffect(() => {
        const timerId = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timerId);
    }, []);

    const formatter = useMemo(() => new Intl.DateTimeFormat('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZone,
    }), [timeZone]);

    const dateFormatter = useMemo(() => new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone,
    }), [timeZone]);

    return {
        formattedTime: formatter.format(time),
        formattedDate: dateFormatter.format(time),
    };
};

// --- Notification Context ---
const NotificationContext = createContext<{
    addNotification: (message: string, type?: AppNotification['type']) => void;
}>({
    addNotification: () => { },
});

const NotificationProvider = ({ children }: { children: React.ReactNode }) => {
    const [notifications, setNotifications] = useState<AppNotification[]>([]);

    const addNotification = useCallback((message: string, type: AppNotification['type'] = 'info') => {
        const id = uuidv4();
        setNotifications(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setNotifications(prev => prev.filter(n => n.id !== id));
        }, 5000); // Auto-dismiss after 5 seconds
    }, []);

    const dismissNotification = (id: string) => {
        setNotifications(prev => prev.filter(n => n.id !== id));
    };

    return (
        <NotificationContext.Provider value={{ addNotification }}>
            {children}
            <div className="notification-container">
                {notifications.map(notification => (
                    <div key={notification.id} className={`notification-item ${notification.type}`}>
                        <span className="notification-message">{notification.message}</span>
                        <button onClick={() => dismissNotification(notification.id)} className="notification-dismiss">&times;</button>
                    </div>
                ))}
            </div>
        </NotificationContext.Provider>
    );
};

const useNotification = () => useContext(NotificationContext);

// --- AI Service Functions ---
async function findSubstitution(leaveRequest: LeaveRequest, timetable: TimetableEntry[], allUsers: User[]): Promise<string> {
    if (!ai || !isAiEnabled) return "AI is not available.";

    const { day, timeIndex, facultyId } = leaveRequest;
    const department = allUsers.find(u => u.id === facultyId)?.dept;


    // Find all faculty in the same department
    const departmentFaculty = allUsers.filter(user => user.role === 'faculty' && user.dept === department && user.id !== facultyId);

    // Find which of them are free during the requested slot
    const freeFaculty = departmentFaculty.filter(faculty => {
        return !timetable.some(entry =>
            entry.faculty === faculty.name &&
            entry.day === day &&
            entry.timeIndex === timeIndex
        );
    });

    if (freeFaculty.length === 0) {
        return "No available faculty in the same department at that time.";
    }

    const prompt = `
        A leave request has been made by ${leaveRequest.facultyName} for a class on ${day} at ${TIME_SLOTS_DEFAULT[timeIndex]}.
        The following faculty members from the same department are available at that time: ${freeFaculty.map(f => f.name).join(', ')}.
        Based on general teaching principles and common subject matter expertise, who would be the most suitable substitute?
        Please provide the name of the recommended faculty member and a very brief, one-sentence justification.
        Example response: "Suggest Prof. John Doe due to his expertise in related subjects."
    `;

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: { thinkingConfig: { thinkingBudget: 0 } }
        });
        return response.text.trim() || "Could not determine a suitable substitute.";
    } catch (error) {
        console.error("AI substitution suggestion failed:", error);
        return "Error getting AI suggestion.";
    }
}

async function assessNewUser(user: Omit<User, 'id' | 'password' | 'status'>): Promise<string> {
    if (!ai || !isAiEnabled) return "AI assessment not available.";

    const { name, role, dept, year } = user;

    const prompt = `
      A new user has registered with the following details:
      - Name: ${name}
      - Role: ${role}
      - Department: ${dept}
      ${year ? `- Year: ${year}` : ''}

      Based on these details, provide a brief, one-sentence summary and an initial risk assessment for an administrator to review.
      Consider the role and department. For example, a student registration is low risk, while a new 'admin' role registration would be high risk.
      Example response: "New faculty registration for the CSE department. Standard verification recommended. Risk: Low."
    `;

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: { thinkingConfig: { thinkingBudget: 0 } }
        });
        return response.text.trim();
    } catch (error) {
        console.error("AI user assessment failed:", error);
        return "Could not perform AI assessment.";
    }
}

async function refineAnnouncement(content: string, targetAudience: string): Promise<string> {
    if (!ai || !isAiEnabled) return content;

    const prompt = `
        Refine the following announcement to be more clear, professional, and engaging for the target audience (${targetAudience}).
        Do not change the core message. Return only the refined text.

        Original announcement: "${content}"
    `;
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt
        });
        return response.text.trim();
    } catch (error) {
        console.error("AI announcement refinement failed:", error);
        // Return original content on error
        return content;
    }
}

async function generateStudentSummary(student: User, requests: ResourceRequest[]): Promise<string> {
    if (!ai || !isAiEnabled) return "AI Summary not available.";

    // In a real app, you'd also pass attendance, grades, etc.
    const requestSummary = requests.map(r => `- "${r.requestText}" (Status: ${r.status})`).join('\n');

    const prompt = `
        Generate a concise, analytical summary for a faculty advisor about the student, ${student.name}.
        Focus on identifying patterns, potential strengths, or areas needing attention.
        The summary should be in markdown format.

        Available Data:
        - Name: ${student.name}
        - Department: ${student.dept}, Year: ${student.year}
        - Recent Resource Requests:
        ${requestSummary || "  - No recent requests."}

        Example Output:
        **Analysis:**
        *   Shows initiative in [topic] based on resource requests.
        *   Appears to be proactive in preparing for [task].
        **Recommendation:**
        *   Follow up on the pending request for lab access to ensure project milestones are met.
        *   Commend their proactive approach to sourcing learning materials.
    `;

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
        });
        return response.text.trim();
    } catch (error) {
        console.error("AI student summary generation failed:", error);
        return "Error generating AI summary.";
    }
}


// --- COMPONENTS ---

const TimetableView = ({ user, timetable, leaveRequests, onCellClick }: {
    user: User;
    timetable: TimetableEntry[];
    leaveRequests: LeaveRequest[];
    onCellClick: (entry: TimetableEntry) => void;
}) => {
    const [viewDept, setViewDept] = useState(user.dept);
    const [viewYear, setViewYear] = useState(user.year || YEARS[0]);

    const canChangeView = user.role === 'admin' || user.role === 'hod';

    const displayedDept = canChangeView ? viewDept : user.dept;
    const displayedYear = user.role === 'student' ? user.year : (canChangeView ? viewYear : 'I');


    const filteredTimetable = useMemo(() => {
        return timetable.filter(entry => entry.department === displayedDept && entry.year === displayedYear);
    }, [timetable, displayedDept, displayedYear]);

    const timetableGrid = useMemo(() => {
        const grid: (TimetableEntry | null)[][] = Array(TIME_SLOTS_DEFAULT.length).fill(0).map(() => Array(DAYS.length).fill(null));
        filteredTimetable.forEach(entry => {
            const dayIndex = DAYS.indexOf(entry.day);
            if (dayIndex !== -1 && entry.timeIndex < TIME_SLOTS_DEFAULT.length) {
                // Apply substitutions from approved leave requests
                const leaveRequest = leaveRequests.find(lr => lr.timetableEntryId === entry.id && lr.status === 'approved' && lr.aiSuggestion);
                if (leaveRequest && leaveRequest.aiSuggestion) {
                    const substituteMatch = leaveRequest.aiSuggestion.match(/Suggest (Prof\.|Dr\.)\s(.*?)\s/);
                    if (substituteMatch && substituteMatch[0]) {
                        const substituteName = leaveRequest.aiSuggestion.split('due to')[0].replace('Suggest ', '').trim();
                        grid[entry.timeIndex][dayIndex] = {
                            ...entry,
                            originalFaculty: entry.faculty,
                            faculty: substituteName
                        };
                    } else {
                        grid[entry.timeIndex][dayIndex] = entry;
                    }
                } else {
                    grid[entry.timeIndex][dayIndex] = entry;
                }
            }
        });
        return grid;
    }, [filteredTimetable, leaveRequests]);


    return (
        <div className="timetable-container">
            <div className="timetable-header">
                <h3>{canChangeView ? 'View Timetable' : `My Timetable (${displayedDept} - Year ${displayedYear})`}</h3>
                {canChangeView && (
                    <div className="timetable-controls">
                        <select className="form-control" value={viewDept} onChange={e => setViewDept(e.target.value)}>
                            {DEPARTMENTS.map(dept => <option key={dept} value={dept}>{dept}</option>)}
                        </select>
                        <select className="form-control" value={viewYear} onChange={e => setViewYear(e.target.value)}>
                            {YEARS.map(year => <option key={year} value={year}>Year {year}</option>)}
                        </select>
                    </div>
                )}
            </div>

            <div className="timetable-grid">
                <div className="grid-header">Time</div>
                {DAYS.map(day => <div key={day} className="grid-header">{day}</div>)}

                {TIME_SLOTS_DEFAULT.map((slot, timeIndex) => (
                    <React.Fragment key={slot}>
                        <div className="time-slot">
                            <span>{slot.split(' - ')[0]}</span>
                            <span>{slot.split(' - ')[1]}</span>
                        </div>
                        {DAYS.map((day, dayIndex) => {
                            const entry = timetableGrid[timeIndex][dayIndex];
                            const isUserClass = user.role === 'faculty' && entry?.faculty === user.name;
                            const isSubstitution = !!entry?.originalFaculty;
                            const canRequestLeave = isUserClass && !isSubstitution && entry.type === 'class';

                            const cellClasses = [
                                "grid-cell",
                                entry ? entry.type : '',
                                isUserClass ? 'is-user-class' : '',
                                isSubstitution ? 'is-substitution' : '',
                                canRequestLeave ? 'can-request-leave' : ''
                            ].join(' ');

                            return (
                                <div key={`${day}-${timeIndex}`} className={cellClasses} onClick={() => canRequestLeave && entry && onCellClick(entry)}>
                                    {entry ? (
                                        <>
                                            <span className="subject">{entry.subject}</span>
                                            {entry.faculty && <span className="faculty">{entry.faculty}</span>}
                                            {entry.originalFaculty && <span className="original-faculty">(Sub for {entry.originalFaculty})</span>}
                                        </>
                                    ) : null}
                                </div>
                            );
                        })}
                    </React.Fragment>
                ))}
            </div>
        </div>
    );
};

const ManageTimetableView = ({ timetable, setTimetable, allUsers, timeSlots, addNotification }: {
    timetable: TimetableEntry[];
    setTimetable: React.Dispatch<React.SetStateAction<TimetableEntry[]>>;
    allUsers: User[];
    timeSlots: string[];
    addNotification: (message: string, type?: AppNotification['type']) => void;
}) => {
    const initialFormState: ManageFormData = { department: 'CSE', year: 'I', day: 'Monday', timeIndex: 0, subject: '', type: 'class', faculty: '' };
    const [formData, setFormData] = useState<ManageFormData>(initialFormState);
    const [editingId, setEditingId] = useState<string | null>(null);
    const facultyList = allUsers.filter(u => u.role === 'faculty' || u.role === 'hod' || u.role === 'class advisor').map(u => u.name);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: name === 'timeIndex' ? parseInt(value, 10) : value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.subject) {
            addNotification("Subject cannot be empty.", "error");
            return;
        };

        const entryExists = timetable.some(
            (entry) =>
                entry.department === formData.department &&
                entry.year === formData.year &&
                entry.day === formData.day &&
                entry.timeIndex === formData.timeIndex &&
                entry.id !== editingId
        );

        if (entryExists) {
            addNotification("An entry already exists for this time slot.", "error");
            return;
        }


        if (editingId) {
            setTimetable(prev => prev.map(entry => entry.id === editingId ? { ...formData, id: editingId } as TimetableEntry : entry));
            addNotification("Entry updated successfully.", "success");
        } else {
            const newEntry: TimetableEntry = { ...formData, id: uuidv4() };
            setTimetable(prev => [...prev, newEntry]);
            addNotification("Entry added successfully.", "success");
        }
        setFormData(initialFormState);
        setEditingId(null);
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
            faculty: entry.faculty || ''
        });
    };

    const handleDelete = (id: string) => {
        if (window.confirm("Are you sure you want to delete this entry?")) {
            setTimetable(prev => prev.filter(entry => entry.id !== id));
            addNotification("Entry deleted.", "info");
        }
    };

    const handleClear = () => {
        setFormData(initialFormState);
        setEditingId(null);
    }

    return (
        <div className="manage-timetable-container">
            <div className="entry-form">
                <h3>{editingId ? "Edit Timetable Entry" : "Add New Timetable Entry"}</h3>
                <form onSubmit={handleSubmit}>
                    <div className="form-grid">
                        <div className="control-group">
                            <label>Department</label>
                            <select className="form-control" name="department" value={formData.department} onChange={handleInputChange}>
                                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </div>
                        <div className="control-group">
                            <label>Year</label>
                            <select className="form-control" name="year" value={formData.year} onChange={handleInputChange}>
                                {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                            </select>
                        </div>
                        <div className="control-group">
                            <label>Day</label>
                            <select className="form-control" name="day" value={formData.day} onChange={handleInputChange}>
                                {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </div>
                        <div className="control-group">
                            <label>Time Slot</label>
                            <select className="form-control" name="timeIndex" value={formData.timeIndex} onChange={handleInputChange}>
                                {timeSlots.map((ts, i) => <option key={i} value={i}>{ts}</option>)}
                            </select>
                        </div>
                        <div className="control-group">
                            <label>Type</label>
                            <select className="form-control" name="type" value={formData.type} onChange={handleInputChange}>
                                <option value="class">Class</option>
                                <option value="break">Break</option>
                                <option value="common">Common Hour</option>
                            </select>
                        </div>
                        <div className="control-group" style={{ gridColumn: 'span 2' }}>
                            <label>Subject / Title</label>
                            <input type="text" className="form-control" name="subject" value={formData.subject} onChange={handleInputChange} required />
                        </div>
                        <div className="control-group">
                            <label>Faculty</label>
                            <select className="form-control" name="faculty" value={formData.faculty} onChange={handleInputChange} disabled={formData.type !== 'class'}>
                                <option value="">N/A</option>
                                {facultyList.map(f => <option key={f} value={f}>{f}</option>)}
                            </select>
                        </div>
                    </div>
                    <div className="form-actions">
                        <button type="button" className="btn btn-secondary" onClick={handleClear}>Clear</button>
                        <button type="submit" className="btn btn-primary">{editingId ? "Update Entry" : "Add Entry"}</button>
                    </div>
                </form>
            </div>
            <div className="entry-list-container">
                <h3>Existing Entries</h3>
                <div style={{ overflowX: 'auto' }}>
                    <table className="entry-list-table">
                        <thead>
                            <tr>
                                <th>Dept-Year</th>
                                <th>Day</th>
                                <th>Time</th>
                                <th>Subject</th>
                                <th>Faculty</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {timetable
                                .sort((a, b) => DEPARTMENTS.indexOf(a.department) - DEPARTMENTS.indexOf(b.department) || a.year.localeCompare(b.year) || DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.timeIndex - b.timeIndex)
                                .map(entry => (
                                    <tr key={entry.id}>
                                        <td>{entry.department}-{entry.year}</td>
                                        <td>{entry.day}</td>
                                        <td>{timeSlots[entry.timeIndex]}</td>
                                        <td>{entry.subject}</td>
                                        <td>{entry.faculty || 'N/A'}</td>
                                        <td className="entry-actions">
                                            <button onClick={() => handleEdit(entry)} title="Edit">{Icons.edit}</button>
                                            <button onClick={() => handleDelete(entry.id)} className="delete-btn" title="Delete">{Icons.delete}</button>
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

const Chatbot = ({ user, isVisible, onToggle, timetable }: {
    user: User;
    isVisible: boolean;
    onToggle: () => void;
    timetable: TimetableEntry[];
}) => {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [chat, setChat] = useState<Chat | null>(null);
    const chatHistoryRef = useRef<HTMLDivElement>(null);
    const [isListening, setIsListening] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [isTtsEnabled, setIsTtsEnabled] = useLocalStorage('ttsEnabled', false);
    const recognitionRef = useRef<any>(null); // SpeechRecognition instance

    useEffect(() => {
        if (chatHistoryRef.current) {
            chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
        }
    }, [messages]);

    useEffect(() => {
        // Initialize or reset chat session when user changes or visibility changes
        if (isVisible && user && ai) {
            const userTimetable = timetable
                .filter(entry => {
                    if (user.role === 'student') return entry.department === user.dept && entry.year === user.year;
                    if (user.role === 'faculty') return entry.faculty === user.name;
                    return true; // For admin/HOD, context can be broader
                })
                .map(({ day, timeIndex, subject, faculty }) =>
                    `- On ${day} at ${TIME_SLOTS_DEFAULT[timeIndex] || 'a scheduled time'}, class: ${subject}` + (faculty ? ` with ${faculty}` : '')
                ).join('\n');

            const systemInstruction = `You are a helpful academic assistant. The user is a ${user.role} named ${user.name}.
            Your knowledge is augmented by their personal timetable.
            When asked about their schedule, use the following information:
            ${userTimetable || "User's timetable is not available or empty."}
            Be concise and helpful.`;

            const newChat = ai.chats.create({
                model: 'gemini-2.5-flash',
                config: { systemInstruction },
            });
            setChat(newChat);
            setMessages([
                { id: uuidv4(), role: 'model', text: `Hello ${user.name}! How can I help you today?` }
            ]);
        } else {
            setChat(null);
            setMessages([]);
        }
    }, [isVisible, user, timetable]); // Rerun when user logs in/out

    const speakText = (text: string) => {
        if (!isTtsEnabled || !('speechSynthesis' in window)) return;
        setIsSpeaking(true);
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);
        speechSynthesis.speak(utterance);
    };


    const handleSend = async (messageText = input) => {
        if (!messageText.trim() || isLoading || !chat) return;

        const newUserMessage: ChatMessage = { id: uuidv4(), role: 'user', text: messageText };
        setMessages(prev => [...prev, newUserMessage]);
        setInput('');
        setIsLoading(true);

        try {
            const result: GenerateContentResponse = await chat.sendMessage({ message: messageText });
            const modelResponse = result.text;
            const sources = result.candidates?.[0]?.groundingMetadata?.groundingChunks as GroundingChunk[];

            const newModelMessage: ChatMessage = {
                id: uuidv4(),
                role: 'model',
                text: modelResponse || "Sorry, I couldn't process that.",
                sources: sources
            };
            setMessages(prev => [...prev, newModelMessage]);
            speakText(modelResponse);

        } catch (error) {
            console.error("Chat error:", error);
            const errorMessage: ChatMessage = { id: uuidv4(), role: 'model', text: "Sorry, I encountered an error. Please try again.", isError: true };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };


    // --- Voice Input ---
    useEffect(() => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognition) {
            recognitionRef.current = new SpeechRecognition();
            recognitionRef.current.continuous = false;
            recognitionRef.current.interimResults = false;
            recognitionRef.current.lang = 'en-US';

            recognitionRef.current.onresult = (event: any) => {
                const transcript = event.results[0][0].transcript;
                setInput(transcript);
                handleSend(transcript); // Automatically send after transcription
                setIsListening(false);
            };

            recognitionRef.current.onerror = (event: any) => {
                console.error('Speech recognition error:', event.error);
                setIsListening(false);
            };

            recognitionRef.current.onend = () => {
                if (isListening) { // if it stops unexpectedly
                    setIsListening(false);
                }
            };

        }
    }, []);

    const toggleListening = () => {
        if (!recognitionRef.current) return;
        if (isListening) {
            recognitionRef.current.stop();
            setIsListening(false);
        } else {
            recognitionRef.current.start();
            setIsListening(true);
        }
    };
    const toggleTts = () => {
        if (isSpeaking) {
            speechSynthesis.cancel();
            setIsSpeaking(false);
        }
        setIsTtsEnabled(prev => !prev);
    };

    return (
        <>
            <button className="fab" onClick={onToggle} aria-label="Toggle AI Assistant">
                {Icons.chat}
            </button>
            <div className={`chat-modal ${isVisible ? 'visible' : ''}`}>
                <div className="chat-header">
                    {Icons.chat} Academic AI Assistant
                </div>
                <div className="chat-history" ref={chatHistoryRef}>
                    {messages.map(msg => (
                        <div key={msg.id} className={`chat-message ${msg.role}`}>
                            <div className="message-bubble-wrapper">
                                <div className={`message-bubble ${msg.role} ${msg.isError ? 'error' : ''}`}
                                    dangerouslySetInnerHTML={{ __html: marked.parse(msg.text) as string }}
                                >
                                </div>
                                {msg.sources && msg.sources.length > 0 && (
                                    <div className="message-sources">
                                        <strong>Sources:</strong>
                                        <ul>
                                            {msg.sources.filter(s => s.web && s.web.uri).map((source, index) => (
                                                <li key={index}>
                                                    <a href={source.web.uri} target="_blank" rel="noopener noreferrer">
                                                        {source.web.title || source.web.uri}
                                                    </a>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                    {isLoading && (
                        <div className="chat-message model">
                            <div className="message-bubble model">
                                <span className="spinner-sm" style={{ margin: 'auto' }}></span>
                            </div>
                        </div>
                    )}
                </div>
                <div className="chat-input-area">
                    {recognitionRef.current && (
                        <button
                            className={`voice-button ${isListening ? 'listening' : ''}`}
                            onClick={toggleListening}
                            disabled={isLoading}
                            aria-label={isListening ? "Stop listening" : "Start listening"}
                        >
                            {Icons.mic}
                        </button>
                    )}
                    <textarea
                        className="chat-input"
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        placeholder="Ask me anything..."
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                        rows={1}
                        disabled={isLoading}
                    />
                    <button
                        className="send-button"
                        onClick={() => handleSend()}
                        disabled={!input.trim() || isLoading}
                        aria-label="Send message"
                    >
                        {Icons.send}
                    </button>
                    {('speechSynthesis' in window) && (
                        <button
                            className={`voice-toggle-button ${isSpeaking ? 'speaking' : ''}`}
                            onClick={toggleTts}
                            aria-label={isTtsEnabled ? "Disable text-to-speech" : "Enable text-to-speech"}
                            title={isTtsEnabled ? "Disable text-to-speech" : "Enable text-to-speech"}
                        >
                            {isTtsEnabled ? Icons.volumeUp : Icons.volumeOff}
                        </button>
                    )}
                </div>
            </div>
        </>
    );
};

const SettingsView = ({ timeSlots, setTimeSlots, allUsers, setAllUsers, announcements, setAnnouncements, addNotification }: {
    timeSlots: string[];
    setTimeSlots: React.Dispatch<React.SetStateAction<string[]>>;
    allUsers: User[];
    setAllUsers: React.Dispatch<React.SetStateAction<User[]>>;
    announcements: Announcement[];
    setAnnouncements: React.Dispatch<React.SetStateAction<Announcement[]>>;
    addNotification: (message: string, type?: AppNotification['type']) => void;
}) => {
    const [newTimeSlot, setNewTimeSlot] = useState("");
    const usersToApprove = allUsers.filter(u => u.status === 'pending_approval');

    const handleAddTimeSlot = () => {
        if (newTimeSlot.trim() && !timeSlots.includes(newTimeSlot.trim())) {
            setTimeSlots(prev => [...prev, newTimeSlot.trim()]);
            setNewTimeSlot("");
            addNotification("Time slot added.", "success");
        } else {
            addNotification("Invalid or duplicate time slot.", "error");
        }
    };
    const handleDeleteTimeSlot = (index: number) => {
        setTimeSlots(prev => prev.filter((_, i) => i !== index));
        addNotification("Time slot removed.", "info");
    };

    const handleUserApproval = (userId: string, isApproved: boolean) => {
        setAllUsers(prev => prev.map(user =>
            user.id === userId ? { ...user, status: isApproved ? 'active' : 'rejected' } : user
        ));
        addNotification(`User ${isApproved ? 'approved' : 'rejected'}.`, isApproved ? 'success' : 'info');
    };

    const handleDeleteAnnouncement = (id: string) => {
        if (window.confirm("Are you sure you want to delete this announcement?")) {
            setAnnouncements(prev => prev.filter(ann => ann.id !== id));
            addNotification("Announcement deleted.", "info");
        }
    };


    return (
        <div className="settings-container">
            <h2>System Settings</h2>
            <div className="settings-card">
                <h3>Manage Time Slots</h3>
                <ul className="timeslot-list">
                    {timeSlots.map((slot, index) => (
                        <li key={index} className="timeslot-item">
                            <span>{slot}</span>
                            <div className="item-actions">
                                <button onClick={() => handleDeleteTimeSlot(index)} className="delete-btn">{Icons.delete}</button>
                            </div>
                        </li>
                    ))}
                </ul>
                <div className="add-timeslot-form">
                    <input
                        type="text"
                        className="form-control"
                        value={newTimeSlot}
                        onChange={e => setNewTimeSlot(e.target.value)}
                        placeholder="e.g., 4:00 - 5:00"
                    />
                    <button className="btn btn-primary" onClick={handleAddTimeSlot}>Add Slot</button>
                </div>
            </div>

            {usersToApprove.length > 0 && (
                <div className="settings-card">
                    <h3>New User Approvals</h3>
                    <ul className="user-approval-list">
                        {usersToApprove.map(user => (
                            <li key={user.id} className="user-approval-item">
                                <div className="user-approval-info">
                                    <span><strong>{user.name}</strong> ({user.id})</span>
                                    <small>{user.role} - {user.dept} {user.year || ''}</small>
                                    {user.aiAssessment && <p className="ai-assessment">{user.aiAssessment}</p>}
                                </div>
                                <div className="item-actions">
                                    <button className="btn btn-sm btn-success" onClick={() => handleUserApproval(user.id, true)}>Approve</button>
                                    <button className="btn btn-sm btn-danger" onClick={() => handleUserApproval(user.id, false)}>Reject</button>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="settings-card">
                <h3>Manage Announcements</h3>
                <ul className="announcements-manage-list">
                    {announcements.map(ann => (
                        <li key={ann.id} className="announcement-manage-item">
                            <div className="ann-manage-info">
                                <span className="ann-manage-title">{ann.title}</span>
                                <div className="ann-manage-meta">
                                    <span>by {ann.author}</span>
                                    <span>({getRelativeTime(ann.timestamp)})</span>
                                    <div className="ann-manage-targets">
                                        <span className="target-pill">{ann.targetRole}</span>
                                        <span className="target-pill">{ann.targetDept}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="item-actions">
                                <button onClick={() => handleDeleteAnnouncement(ann.id)} className="delete-btn">{Icons.delete}</button>
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};

const ApprovalsView = ({ leaveRequests, setLeaveRequests, allUsers, timetable, addNotification }: {
    leaveRequests: LeaveRequest[];
    setLeaveRequests: React.Dispatch<React.SetStateAction<LeaveRequest[]>>;
    allUsers: User[];
    timetable: TimetableEntry[];
    addNotification: (message: string, type?: AppNotification['type']) => void;
}) => {
    const [activeTab, setActiveTab] = useState('leave');
    const pendingLeaveRequests = leaveRequests.filter(lr => lr.status === 'pending');
    const pendingUserRequests = allUsers.filter(u => u.status === 'pending_approval');

    const handleLeaveApproval = (reqId: string, isApproved: boolean) => {
        setLeaveRequests(prev => prev.map(req => {
            if (req.id === reqId) {
                if (isApproved && req.aiSuggestion) {
                    // Logic to apply the substitution to the timetable
                    const updatedTimetable = timetable.map(entry => {
                        if (entry.id === req.timetableEntryId) {
                            const substituteName = req.aiSuggestion.split('due to')[0].replace('Suggest ', '').trim();
                            return { ...entry, originalFaculty: entry.faculty, faculty: substituteName };
                        }
                        return entry;
                    });
                    // This part is tricky as we can't directly setTimetable here.
                    // A better state management (like context/redux) would solve this.
                    // For now, we'll just approve the request.
                }
                return { ...req, status: isApproved ? 'approved' : 'rejected' };
            }
            return req;
        }));
        addNotification(`Leave request ${isApproved ? 'approved' : 'rejected'}.`, isApproved ? 'success' : 'info');
    };

    const generateSuggestion = async (reqId: string) => {
        setLeaveRequests(prev => prev.map(req => req.id === reqId ? { ...req, aiSuggestion: 'Generating...' } : req));
        const request = leaveRequests.find(r => r.id === reqId);
        if (request) {
            const suggestion = await findSubstitution(request, timetable, allUsers);
            setLeaveRequests(prev => prev.map(req => req.id === reqId ? { ...req, aiSuggestion: suggestion } : req));
        }
    };

    return (
        <div className="approvals-container">
            <div className="tabs">
                <button
                    className={`tab-button ${activeTab === 'leave' ? 'active' : ''}`}
                    onClick={() => setActiveTab('leave')}
                >
                    Leave Requests ({pendingLeaveRequests.length})
                </button>
                {/* User approvals are now in Settings, but could be here too in a different flow */}
            </div>
            {activeTab === 'leave' && (
                <div className="approval-list">
                    {pendingLeaveRequests.length === 0 ? <p>No pending leave requests.</p> :
                        pendingLeaveRequests.map(req => {
                            const entry = timetable.find(t => t.id === req.timetableEntryId);
                            return (
                                <div key={req.id} className="approval-card">
                                    <div className="approval-card-main">
                                        <h4>Leave Request</h4>
                                        <p><strong>Faculty:</strong> {req.facultyName}</p>
                                        {entry && <p><strong>Class:</strong> {entry.subject} ({entry.department} - {entry.year})</p>}
                                        <p><strong>Time:</strong> {req.day}, {TIME_SLOTS_DEFAULT[req.timeIndex]}</p>
                                        {req.reason && <p><strong>Reason:</strong> {req.reason}</p>}
                                        <small>Requested {getRelativeTime(req.timestamp)}</small>
                                    </div>
                                    <div className="approval-card-ai">
                                        <h5>AI Substitution Suggestion</h5>
                                        {req.aiSuggestion ?
                                            <p className="ai-suggestion">
                                                {req.aiSuggestion === 'Generating...' ? <span className="spinner-sm" /> : req.aiSuggestion}
                                            </p>
                                            :
                                            <button className="btn btn-sm btn-secondary" onClick={() => generateSuggestion(req.id)}>
                                                Find Substitute
                                            </button>
                                        }
                                    </div>
                                    <div className="approval-card-actions">
                                        <button className="btn btn-success" onClick={() => handleLeaveApproval(req.id, true)}>Approve</button>
                                        <button className="btn btn-danger" onClick={() => handleLeaveApproval(req.id, false)}>Reject</button>
                                    </div>
                                </div>
                            );
                        })}
                </div>
            )}
        </div>
    );
};

const AnnouncementsView = ({ user, announcements, setAnnouncements, addNotification }: {
    user: User;
    announcements: Announcement[];
    setAnnouncements: React.Dispatch<React.SetStateAction<Announcement[]>>;
    addNotification: (message: string, type?: AppNotification['type']) => void;
}) => {
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [isRefining, setIsRefining] = useState(false);
    const initialFormState = {
        title: "",
        content: "",
        targetRole: "all" as Announcement['targetRole'],
        targetDept: "all" as Announcement['targetDept'],
    };
    const [formData, setFormData] = useState(initialFormState);
    const canCreate = user.role === 'admin' || user.role === 'hod';

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleRefine = async () => {
        if (!formData.content.trim() || !isAiEnabled) return;
        setIsRefining(true);
        const targetAudience = `${formData.targetRole} in ${formData.targetDept === 'all' ? 'all departments' : formData.targetDept}`;
        const refinedContent = await refineAnnouncement(formData.content, targetAudience);
        setFormData(prev => ({ ...prev, content: refinedContent }));
        setIsRefining(false);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.title.trim() || !formData.content.trim()) {
            addNotification("Title and content cannot be empty.", "error");
            return;
        }

        const newAnnouncement: Announcement = {
            id: uuidv4(),
            title: formData.title,
            content: formData.content,
            author: user.role === 'hod' ? `HOD (${user.dept})` : 'Admin',
            timestamp: Date.now(),
            targetRole: formData.targetRole,
            targetDept: formData.targetDept,
        };

        setAnnouncements(prev => [newAnnouncement, ...prev]);
        addNotification("Announcement published.", "success");
        setFormData(initialFormState);
        setShowCreateForm(false);
    };

    const userAnnouncements = useMemo(() => {
        return announcements.filter(ann =>
            (ann.targetRole === 'all' || ann.targetRole === user.role) &&
            (ann.targetDept === 'all' || ann.targetDept === user.dept)
        ).sort((a, b) => b.timestamp - a.timestamp);
    }, [announcements, user]);

    return (
        <div className="announcements-view-container">
            <div className="announcements-header">
                <h2>Announcements</h2>
                {canCreate && (
                    <button className="btn btn-primary" onClick={() => setShowCreateForm(p => !p)}>
                        {showCreateForm ? 'Cancel' : 'Create Announcement'}
                    </button>
                )}
            </div>

            {showCreateForm && (
                <form className="create-announcement-form" onSubmit={handleSubmit}>
                    <h3>New Announcement</h3>
                    <div className="control-group">
                        <label>Title</label>
                        <input type="text" className="form-control" name="title" value={formData.title} onChange={handleInputChange} />
                    </div>
                    <div className="control-group">
                        <label>Content</label>
                        <div className="refine-button-container">
                            <textarea className="form-control" name="content" value={formData.content} onChange={handleInputChange} rows={5} />
                            {isAiEnabled &&
                                <button type="button" className="btn btn-sm btn-secondary refine-btn" onClick={handleRefine} disabled={isRefining || !formData.content.trim()}>
                                    {isRefining ? <span className="spinner-sm" /> : Icons.refine}
                                    {isRefining ? ' Refining...' : ' Refine with AI'}
                                </button>
                            }
                        </div>
                    </div>
                    <div className="form-grid">
                        <div className="control-group">
                            <label>Target Role</label>
                            <select className="form-control" name="targetRole" value={formData.targetRole} onChange={handleInputChange}>
                                <option value="all">All Roles</option>
                                <option value="student">Students</option>
                                <option value="faculty">Faculty</option>
                            </select>
                        </div>
                        <div className="control-group">
                            <label>Target Department</label>
                            <select className="form-control" name="targetDept" value={formData.targetDept} onChange={handleInputChange}>
                                <option value="all">All Departments</option>
                                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </div>
                    </div>
                    <div className="form-actions">
                        <button type="submit" className="btn btn-primary">Publish</button>
                    </div>
                </form>
            )}

            <div className="announcement-list">
                {userAnnouncements.map(ann => (
                    <div key={ann.id} className="announcement-card">
                        <div className="announcement-item-header">
                            <h3>{ann.title}</h3>
                            <div className="announcement-item-meta">
                                <span><strong>{ann.author}</strong></span>
                                <span>{getRelativeTime(ann.timestamp)}</span>
                            </div>
                        </div>
                        <div className="announcement-item-targets">
                            <span className="target-pill">{ann.targetRole}</span>
                            <span className="target-pill">{ann.targetDept}</span>
                        </div>
                        <div className="announcement-item-content">
                            {ann.content}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

const StudentDashboard = ({ user, timetable, leaveRequests, resourceRequests, setResourceRequests, addNotification }: {
    user: User;
    timetable: TimetableEntry[];
    leaveRequests: LeaveRequest[];
    resourceRequests: ResourceRequest[];
    setResourceRequests: React.Dispatch<React.SetStateAction<ResourceRequest[]>>;
    addNotification: (message: string, type?: AppNotification['type']) => void;
}) => {
    const [requestText, setRequestText] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmitRequest = (e: React.FormEvent) => {
        e.preventDefault();
        if (!requestText.trim()) return;

        setIsSubmitting(true);
        // Simulate async submission
        setTimeout(() => {
            const newRequest: ResourceRequest = {
                id: uuidv4(),
                userId: user.id,
                requestText: requestText,
                status: 'pending',
                timestamp: Date.now(),
            };
            setResourceRequests(prev => [newRequest, ...prev]);
            setRequestText("");
            setIsSubmitting(false);
            addNotification("Your request has been submitted.", "success");
        }, 500);
    };

    const userRequests = resourceRequests.filter(r => r.userId === user.id);


    return (
        <div className="dashboard-student">
            <div className="dashboard-grid">
                <TodayScheduleCard user={user} timetable={timetable} leaveRequests={leaveRequests} />
                <div className="dashboard-card">
                    <h3>Recent Attendance</h3>
                    <div className="attendance-grid">
                        <div className="attendance-day">
                            <div className="attendance-status present"></div>
                            <span className="attendance-day-label">Mon</span>
                        </div>
                        <div className="attendance-day">
                            <div className="attendance-status present"></div>
                            <span className="attendance-day-label">Tue</span>
                        </div>
                        <div className="attendance-day">
                            <div className="attendance-status late"></div>
                            <span className="attendance-day-label">Wed</span>
                        </div>
                        <div className="attendance-day">
                            <div className="attendance-status absent"></div>
                            <span className="attendance-day-label">Thu</span>
                        </div>
                        <div className="attendance-day">
                            <div className="attendance-status present"></div>
                            <span className="attendance-day-label">Fri</span>
                        </div>
                    </div>
                    <div className="attendance-legend">
                        <div className="legend-item"><span className="legend-dot present"></span> Present</div>
                        <div className="legend-item"><span className="legend-dot late"></span> Late</div>
                        <div className="legend-item"><span className="legend-dot absent"></span> Absent</div>
                    </div>
                </div>

                <div className="dashboard-card">
                    <h3>Request Resources</h3>
                    <form onSubmit={handleSubmitRequest} className="resource-request-form">
                        <div className="control-group">
                            <label htmlFor="resourceRequest">Need access to lab equipment, library books, or other resources? Let us know.</label>
                            <textarea
                                id="resourceRequest"
                                className="form-control"
                                rows={3}
                                value={requestText}
                                onChange={e => setRequestText(e.target.value)}
                                placeholder="e.g., Requesting access to the high-performance computing lab for my final year project."
                            />
                        </div>
                        <div className="form-actions" style={{ marginTop: '1rem' }}>
                            <button type="submit" className="btn btn-primary" disabled={isSubmitting || !requestText.trim()}>
                                {isSubmitting ? "Submitting..." : "Submit Request"}
                            </button>
                        </div>
                    </form>
                    <div className="request-history-container">
                        <h4>My Request History</h4>
                        {userRequests.length > 0 ? (
                            <ul className="resource-request-list">
                                {userRequests.map(req => (
                                    <li key={req.id} className="resource-request-item">
                                        <div className="request-details">
                                            <span className="request-text" title={req.requestText}>{req.requestText}</span>
                                            <span className="request-timestamp">{getRelativeTime(req.timestamp)}</span>
                                        </div>
                                        <span className={`status-pill ${req.status}`}>{req.status}</span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="no-history-text">You have no previous requests.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

const TodayScheduleCard = ({ user, timetable, leaveRequests }: {
    user: User;
    timetable: TimetableEntry[];
    leaveRequests: LeaveRequest[];
}) => {
    const today = DAYS[new Date().getDay() - 1] || 'Sunday'; // Adjust for Sunday
    const scheduleToday = useMemo(() => {
        const userTimetable = timetable.filter(entry => {
            if (user.role === 'student') return entry.department === user.dept && entry.year === user.year && entry.day === today;
            if (user.role === 'faculty' || user.role === 'hod' || user.role === 'class advisor') return entry.faculty === user.name && entry.day === today;
            return false;
        });

        // Apply substitutions
        return userTimetable.map(entry => {
            const leave = leaveRequests.find(lr => lr.timetableEntryId === entry.id && lr.status === 'approved');
            if (leave) {
                return { ...entry, subject: `(Leave Approved) ${entry.subject}`, type: 'break' as 'break' }; // Treat as a free period
            }
            return entry;
        }).sort((a, b) => a.timeIndex - b.timeIndex);

    }, [user, timetable, leaveRequests, today]);

    return (
        <div className="dashboard-card">
            <h3>Today's Schedule ({today})</h3>
            {scheduleToday.length > 0 ? (
                <ul className="schedule-list">
                    {scheduleToday.map(item => (
                        <li key={item.id} className={`schedule-item ${item.type}`}>
                            <span className="time">{TIME_SLOTS_DEFAULT[item.timeIndex]}</span>
                            <span className="subject">{item.subject}</span>
                            {user.role === 'student' && <span className="faculty">{item.faculty}</span>}
                        </li>
                    ))}
                </ul>
            ) : (
                <p>No classes scheduled for today. Enjoy your day!</p>
            )}
        </div>
    )
}

const FacultyDashboard = ({ user, timetable, leaveRequests }: {
    user: User;
    timetable: TimetableEntry[];
    leaveRequests: LeaveRequest[];
}) => {
    const pendingRequests = leaveRequests.filter(lr => lr.facultyId === user.id);

    return (
        <div className="dashboard-faculty">
            <div className="dashboard-grid">
                <TodayScheduleCard user={user} timetable={timetable} leaveRequests={leaveRequests} />

                <div className="dashboard-card">
                    <h3>My Leave Requests</h3>
                    {pendingRequests.length > 0 ? (
                        <ul className="schedule-list">
                            {pendingRequests.map(req => (
                                <li key={req.id} className="schedule-item">
                                    <span className="time">{req.day}, {TIME_SLOTS_DEFAULT[req.timeIndex]}</span>
                                    <span>Leave Request</span>
                                    <span className={`status-pill ${req.status}`}>{req.status}</span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p>You have no pending leave requests.</p>
                    )}
                </div>
                <div id="weekly-faculty-view" className="dashboard-card">
                    <h3>My Weekly View</h3>
                    <div className="weekly-view-grid">
                        {DAYS.map(day => (
                            <div key={day} className="weekly-day-column">
                                <div className="weekly-day-header">{day}</div>
                                <div className="weekly-day-classes">
                                    {timetable.filter(c => c.faculty === user.name && c.day === day && c.type === 'class').sort((a, b) => a.timeIndex - b.timeIndex).map(c => (
                                        <div key={c.id} className="weekly-class-item">
                                            <span className="class-time">{TIME_SLOTS_DEFAULT[c.timeIndex]}</span>
                                            <span className="class-subject" title={c.subject}>{c.subject}</span>
                                            <span className="class-info">{c.department} - Year {c.year}</span>
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

const BriefingLoader = () => (
    <div className="briefing-skeleton-loader">
        <div className="skeleton skeleton-line" style={{ width: '80%', height: '1.2rem', marginBottom: '1rem' }}></div>
        <div className="briefing-grid">
            <div className="briefing-item">
                <div className="skeleton skeleton-line" style={{ width: '50%', marginBottom: '0.75rem' }}></div>
                <div className="skeleton skeleton-line" style={{ width: '90%' }}></div>
                <div className="skeleton skeleton-line" style={{ width: '70%' }}></div>
            </div>
            <div className="briefing-item">
                <div className="skeleton skeleton-line" style={{ width: '50%', marginBottom: '0.75rem' }}></div>
                <div className="skeleton skeleton-line" style={{ width: '90%' }}></div>
                <div className="skeleton skeleton-line" style={{ width: '70%' }}></div>
            </div>
            <div className="briefing-item" style={{ gridColumn: '1 / -1' }}>
                <div className="skeleton skeleton-line" style={{ width: '30%', marginBottom: '0.75rem' }}></div>
                <div className="skeleton skeleton-line" style={{ width: '100%' }}></div>
                <div className="skeleton skeleton-line" style={{ width: '100%' }}></div>
            </div>
        </div>
    </div>
);

const BriefingError = ({ error, onRetry }: { error: string, onRetry: () => void }) => (
    <div className="briefing-error">
        <h4>{Icons.warning} Briefing Failed</h4>
        <p>{error}</p>
        <button className="btn btn-secondary" onClick={onRetry}>
            {Icons.retry} Try Again
        </button>
    </div>
);


const DailyIntelligenceBriefingCard = ({ locationData }: { locationData: { city: string | null, country: string | null, error: string | null } }) => {
    const [briefing, setBriefing] = useState<BriefingData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const generateDailyBriefing = useCallback(async () => {
        if (!isAiEnabled || !ai) {
            setError("AI features are not available. Please configure the API key.");
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        setError(null);

        const locationString = locationData.city && locationData.country
            ? `${locationData.city}, ${locationData.country}`
            : 'the user\'s current location';

        const prompt = `
            You are an intelligence analyst providing a daily briefing for a school administrator in ${locationString}.
            Your task is to provide a concise, actionable summary of local conditions and relevant educational news.
            Use Google Search to find real-time, up-to-date information.

            Please provide your response as a single, valid JSON object only, with no other text or markdown formatting. The JSON object must conform to the following structure:
            {
              "localSummary": "A brief summary of the local weather forecast and any significant local events for today.",
              "transportAdvisory": {
                "status": "A short advisory on local traffic and transport conditions (e.g., 'Normal traffic flow', 'Minor delays on M25').",
                "severity": "One of 'low', 'medium', or 'high' based on the potential disruption."
              },
              "educationTrends": [
                {
                  "title": "The title of a recent, relevant news article or trend in education.",
                  "url": "The direct URL to the source article."
                }
              ]
            }

            Ensure the educationTrends array contains 2-3 recent and relevant articles.
        `;

        try {
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: {
                    tools: [{ googleSearch: {} }],
                },
            });

            let jsonString = response.text.trim();
            const jsonMatch = jsonString.match(/```json\n([\s\S]*?)\n```/);
            if (jsonMatch) {
                jsonString = jsonMatch[1];
            }

            const parsedData = JSON.parse(jsonString) as BriefingData;

            if (!parsedData.localSummary || !parsedData.transportAdvisory || !Array.isArray(parsedData.educationTrends)) {
                throw new Error("Received incomplete data from AI.");
            }

            setBriefing(parsedData);
            sessionStorage.setItem('dailyBriefing', JSON.stringify(parsedData));
            sessionStorage.setItem('dailyBriefingTime', Date.now().toString());

        } catch (e) {
            console.error("Failed to generate or parse daily briefing:", e);
            setError("The AI failed to generate a valid briefing. It might be a temporary issue with the model or the connection.");
        } finally {
            setIsLoading(false);
        }
    }, [locationData]);

    useEffect(() => {
        const cachedBriefing = sessionStorage.getItem('dailyBriefing');
        const cacheTime = sessionStorage.getItem('dailyBriefingTime');
        let dataToGenerate = true;

        if (cachedBriefing && cacheTime) {
            const lastGenerated = new Date(parseInt(cacheTime));
            const now = new Date();
            // Invalidate cache if it's a new day
            if (lastGenerated.getDate() === now.getDate() && lastGenerated.getMonth() === now.getMonth()) {
                setBriefing(JSON.parse(cachedBriefing));
                setIsLoading(false);
                dataToGenerate = false;
            }
        }
        
        if (dataToGenerate) {
            generateDailyBriefing();
        }

    }, [generateDailyBriefing]);
    
    const renderContent = () => briefing && (
        <div className="briefing-content">
             <div className="briefing-grid">
                <div className="briefing-item">
                    <div className="briefing-item-header">
                        {Icons.cloud} <h4>Local Summary</h4>
                    </div>
                    <p>{briefing.localSummary}</p>
                </div>

                <div className="briefing-item">
                    <div className="briefing-item-header">
                        {Icons.transport} <h4>Transport Advisory</h4>
                    </div>
                    <div className="transport-status">
                        <span className={`severity-dot ${briefing.transportAdvisory.severity}`}></span>
                        <p>{briefing.transportAdvisory.status}</p>
                    </div>
                </div>

                <div className="briefing-item" style={{ gridColumn: '1 / -1' }}>
                     <div className="briefing-item-header">
                        {Icons.education} <h4>Education Trends</h4>
                    </div>
                    <ul>
                        {briefing.educationTrends.map((trend, index) => (
                            <li key={index}>
                                <a href={trend.url} target="_blank" rel="noopener noreferrer">{trend.title}</a>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </div>
    );
    
    return (
        <div className="dashboard-card briefing-card">
            <h3 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem', marginBottom: '1rem' }}>{Icons.dashboard} Daily Intelligence Briefing</h3>
            {isLoading ? <BriefingLoader /> : error ? <BriefingError error={error} onRetry={generateDailyBriefing} /> : briefing ? renderContent() : <p>No briefing available.</p>}
        </div>
    );
};


const RecentActivityCard = ({ leaveRequests, allUsers, resourceRequests }: {
    leaveRequests: LeaveRequest[];
    allUsers: User[];
    resourceRequests: ResourceRequest[];
}) => {
    const recentActivity = [
        ...leaveRequests.filter(lr => lr.status !== 'pending').map(lr => ({ ...lr, type: 'leave' })),
        ...allUsers.filter(u => u.status !== 'pending_approval').map(u => ({ ...u, type: 'user' })),
        // ...resourceRequests.map(rr => ({...rr, type: 'resource'})) // Can be added later
    ]
        .sort((a, b) => ('timestamp' in b && b.timestamp ? b.timestamp : 0) - ('timestamp' in a && a.timestamp ? a.timestamp : 0)) // Note: users don't have timestamps, will be at the end
        .slice(0, 5);

    return (
        <div className="dashboard-card">
            <h3>Recent Activity</h3>
            <ul className="activity-feed-list">
                {leaveRequests.filter(lr => lr.status !== 'pending').slice(0, 5).map(item => (
                    <li key={item.id} className="activity-feed-item">
                        <div className={`activity-icon ${item.status}`}>
                            {item.status === 'approved' ? Icons.check : Icons.close}
                        </div>
                        <div className="activity-details">
                            <p><strong>{item.facultyName}</strong>'s leave request was {item.status}.</p>
                            <small>{getRelativeTime(item.timestamp)}</small>
                        </div>
                    </li>
                ))}
                {/* Could add other activities like user approvals here */}
            </ul>
        </div>
    );
}

const FacultyWorkloadCard = ({ allUsers, timetable }: {
    allUsers: User[];
    timetable: TimetableEntry[];
}) => {
    const facultyList = allUsers.filter(u => u.role === 'faculty' || u.role === 'hod');
    const workload = facultyList.map(faculty => {
        const hours = timetable.filter(entry => entry.faculty === faculty.name && entry.type === 'class').length;
        return { name: faculty.name, hours };
    }).sort((a, b) => b.hours - a.hours);

    const maxHours = Math.max(...workload.map(w => w.hours), 1); // Avoid division by zero

    return (
        <div className="dashboard-card">
            <h3>Faculty Workload (Classes/Week)</h3>
            <div className="workload-chart-container">
                <ul className="workload-list">
                    {workload.map(item => (
                        <li key={item.name} className="workload-item">
                            <span className="faculty-name" title={item.name}>{item.name}</span>
                            <div className="workload-bar">
                                <div className="bar-fill" style={{ width: `${(item.hours / maxHours) * 100}%` }}>
                                    <span>{item.hours}</span>
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};

const AdminDashboard = ({ user, locationData, leaveRequests, allUsers, timetable, resourceRequests }: {
    user: User;
    locationData: { city: string | null; country: string | null; error: string | null };
    leaveRequests: LeaveRequest[];
    allUsers: User[];
    timetable: TimetableEntry[];
    resourceRequests: ResourceRequest[];
}) => {
    return (
        <div className="dashboard-admin">
            <div className="dashboard-grid">
                <DailyIntelligenceBriefingCard locationData={locationData} />
                <RecentActivityCard leaveRequests={leaveRequests} allUsers={allUsers} resourceRequests={resourceRequests} />
                <FacultyWorkloadCard allUsers={allUsers} timetable={timetable} />
            </div>
        </div>
    )
}


const DashboardView = ({ user, timetable, leaveRequests, allUsers, resourceRequests, setResourceRequests, addNotification }: {
    user: User;
    timetable: TimetableEntry[];
    leaveRequests: LeaveRequest[];
    allUsers: User[];
    resourceRequests: ResourceRequest[];
    setResourceRequests: React.Dispatch<React.SetStateAction<ResourceRequest[]>>;
    addNotification: (message: string, type?: AppNotification['type']) => void;
}) => {
    const locationData = useLocation();
    const localTime = useLiveTime(Intl.DateTimeFormat().resolvedOptions().timeZone);
    const utcTime = useLiveTime('UTC');

    const renderDashboardByRole = () => {
        switch (user.role) {
            case 'student':
                return <StudentDashboard user={user} timetable={timetable} leaveRequests={leaveRequests} resourceRequests={resourceRequests} setResourceRequests={setResourceRequests} addNotification={addNotification} />;
            case 'faculty':
            case 'hod':
            case 'class advisor':
                return <FacultyDashboard user={user} timetable={timetable} leaveRequests={leaveRequests} />;
            case 'admin':
                return <AdminDashboard user={user} locationData={locationData} leaveRequests={leaveRequests} allUsers={allUsers} timetable={timetable} resourceRequests={resourceRequests}/>;
            default:
                return <p>Dashboard not available for your role.</p>;
        }
    };


    return (
        <div className="dashboard-container">
            <div className="realtime-header">
                <div className="location-info">
                    {locationData.error ?
                        <span className="location-error" title={locationData.error}>Location unavailable</span>
                        :
                        (locationData.city ? `${locationData.city}, ${locationData.country}` : 'Loading location...')
                    }
                </div>
                <div className="time-info">
                    <div className="time-zone-block">
                        <span className="time-zone-label">Local Time</span>
                        <span className="live-time">{localTime.formattedTime}</span>
                        <span className="live-date">{localTime.formattedDate}</span>
                    </div>
                    <div className="time-zone-block">
                        <span className="time-zone-label">UTC</span>
                        <span className="live-time">{utcTime.formattedTime}</span>
                        <span className="live-date">{utcTime.formattedDate}</span>
                    </div>
                </div>
            </div>
            {renderDashboardByRole()}
        </div>
    );
};

const StudentDirectoryView = ({ allUsers, resourceRequests, addNotification }: {
    allUsers: User[];
    resourceRequests: ResourceRequest[];
    setResourceRequests: React.Dispatch<React.SetStateAction<ResourceRequest[]>>;
    addNotification: (message: string, type?: AppNotification['type']) => void;
}) => {
    const [filter, setFilter] = useState({ dept: "all", year: "all" });
    const [selectedStudent, setSelectedStudent] = useState<User | null>(null);
    const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);

    const handleFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setFilter(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const filteredStudents = useMemo(() => {
        return allUsers.filter(u =>
            u.role === 'student' &&
            u.status === 'active' &&
            (filter.dept === "all" || u.dept === filter.dept) &&
            (filter.year === "all" || u.year === filter.year)
        ).sort((a, b) => a.name.localeCompare(b.name));
    }, [allUsers, filter]);

    const handleStudentClick = async (student: User) => {
        setSelectedStudent(student);
        if (isAiEnabled && !student.aiSummary) {
            setIsGeneratingSummary(true);
            const summary = await generateStudentSummary(student, resourceRequests.filter(r => r.userId === student.id));
            // This won't persist as we don't have setAllUsers.
            // In a real app, this would update the central user state.
            setSelectedStudent(prev => prev ? { ...prev, aiSummary: summary } : null);
            setIsGeneratingSummary(false);
        }
    };

    return (
        <div className="student-directory-container">
            <div className="directory-header">
                <h2>Student Directory</h2>
                <div className="directory-controls form-grid">
                    <select name="dept" value={filter.dept} onChange={handleFilterChange} className="form-control">
                        <option value="all">All Departments</option>
                        {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <select name="year" value={filter.year} onChange={handleFilterChange} className="form-control">
                        <option value="all">All Years</option>
                        {YEARS.map(y => <option key={y} value={y}>Year {y}</option>)}
                    </select>
                </div>
            </div>
            <div className="student-list">
                {filteredStudents.map(student => (
                    <div key={student.id} className="student-list-item" onClick={() => handleStudentClick(student)}>
                        <div className="student-info">
                            <span className="student-name">{student.name}</span>
                            <span className="student-id">{student.id}</span>
                        </div>
                        <div className="student-details">
                            <span>{student.dept} - Year {student.year}</span>
                        </div>
                    </div>
                ))}
            </div>

            {selectedStudent && (
                <div className="modal-overlay open student-profile-modal-overlay">
                    <div className="modal-content student-profile-modal">
                        <div className="student-profile-header">
                            <h3>{selectedStudent.name}'s Profile</h3>
                            <button className="close-modal-btn" onClick={() => setSelectedStudent(null)}>&times;</button>
                        </div>
                        <div className="student-profile-grid">
                            <div className="profile-section">
                                <h4>Academic Details</h4>
                                <p><strong>Student ID:</strong> {selectedStudent.id}</p>
                                <p><strong>Department:</strong> {selectedStudent.dept}</p>
                                <p><strong>Year:</strong> {selectedStudent.year}</p>
                                <p><strong>Status:</strong> <span style={{ textTransform: 'capitalize' }}>{selectedStudent.status}</span></p>
                            </div>
                            <div className="profile-section">
                                <h4>Attendance Summary (Last 5 Days)</h4>
                                <div className="attendance-grid-modal">
                                    <div className="attendance-day-modal"><div className="attendance-status-modal present"></div><span className="attendance-day-label-modal">M</span></div>
                                    <div className="attendance-day-modal"><div className="attendance-status-modal present"></div><span className="attendance-day-label-modal">T</span></div>
                                    <div className="attendance-day-modal"><div className="attendance-status-modal late"></div><span className="attendance-day-label-modal">W</span></div>
                                    <div className="attendance-day-modal"><div className="attendance-status-modal absent"></div><span className="attendance-day-label-modal">T</span></div>
                                    <div className="attendance-day-modal"><div className="attendance-status-modal present"></div><span className="attendance-day-label-modal">F</span></div>
                                </div>
                            </div>
                            <div className="profile-section request-history-section">
                                <h4>Resource Request History</h4>
                                <ul className="resource-request-list">
                                    {resourceRequests.filter(r => r.userId === selectedStudent.id).map(req => (
                                        <li key={req.id} className="resource-request-item">
                                            <div className="request-details">
                                                <span className="request-text" title={req.requestText}>{req.requestText}</span>
                                                <span className="request-timestamp">{getRelativeTime(req.timestamp)}</span>
                                            </div>
                                            <span className={`status-pill ${req.status}`}>{req.status}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                            <div className="profile-section ai-summary-section">
                                <h4>AI-Generated Performance Summary</h4>
                                <div className="ai-summary-container">
                                    {isGeneratingSummary ?
                                        <div className="briefing-loader"><span className="spinner"></span></div>
                                        :
                                        (selectedStudent.aiSummary ?
                                            <div dangerouslySetInnerHTML={{ __html: marked.parse(selectedStudent.aiSummary) as string }}></div>
                                            : <p>No summary generated.</p>
                                        )
                                    }
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const LeaveRequestModal = ({ entry, user, onClose, setLeaveRequests, addNotification }: {
    entry: TimetableEntry;
    user: User;
    onClose: () => void;
    setLeaveRequests: React.Dispatch<React.SetStateAction<LeaveRequest[]>>;
    addNotification: (message: string, type?: AppNotification['type']) => void;
}) => {
    const [reason, setReason] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setTimeout(() => {
            const newRequest: LeaveRequest = {
                id: uuidv4(),
                facultyId: user.id,
                facultyName: user.name,
                timetableEntryId: entry.id,
                day: entry.day,
                timeIndex: entry.timeIndex,
                status: 'pending',
                reason: reason,
                timestamp: Date.now(),
            };
            setLeaveRequests(prev => [newRequest, ...prev]);
            setIsSubmitting(false);
            addNotification("Leave request submitted successfully.", "success");
            onClose();
        }, 500);
    };

    return (
        <div className="modal-overlay open">
            <div className="modal-content leave-request-modal">
                <div className="modal-header">
                    <h3>Request Leave</h3>
                    <button onClick={onClose} className="close-modal-btn">&times;</button>
                </div>
                <div className="leave-request-details">
                    <p><strong>Class:</strong> {entry.subject}</p>
                    <p><strong>Time:</strong> {entry.day}, {TIME_SLOTS_DEFAULT[entry.timeIndex]}</p>
                    <p><strong>Audience:</strong> {entry.department} - Year {entry.year}</p>
                </div>
                <form onSubmit={handleSubmit} className="leave-request-form">
                    <div className="control-group">
                        <label htmlFor="leaveReason">Reason for Leave (Optional)</label>
                        <textarea
                            id="leaveReason"
                            className="form-control"
                            rows={3}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="e.g., Attending a conference, personal appointment."
                        />
                    </div>
                    <div className="form-actions" style={{ justifyContent: 'flex-end', marginTop: 0 }}>
                        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                            {isSubmitting ? "Submitting..." : "Submit Request"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};


// --- AUTHENTICATION ---
const AuthView = ({ setUsers, setCurrentUser, addNotification }: {
    setUsers: (users: User[] | ((prevUsers: User[]) => User[])) => void;
    setCurrentUser: React.Dispatch<React.SetStateAction<User | null>>;
    addNotification: (message: string, type?: AppNotification['type']) => void;
}) => {
    const [isLogin, setIsLogin] = useState(true);
    const [error, setError] = useState('');
    const [loginId, setLoginId] = useState('');
    const [password, setPassword] = useState('');

    // Signup form state
    const [signupData, setSignupData] = useState({
        id: '', name: '', password: '', role: 'student' as UserRole, dept: 'CSE', year: 'I'
    });

    const handleLogin = (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        const users = JSON.parse(localStorage.getItem('users') || '[]');
        const user = users.find((u: User) => u.id === loginId); // No password check for this demo

        if (user) {
            if (user.status === 'active') {
                setCurrentUser(user);
                addNotification(`Welcome back, ${user.name}!`, "success");
            } else {
                setError(`Your account status is: ${user.status.replace('_', ' ')}.`);
            }
        } else {
            setError('Invalid credentials. Please try again.');
        }
    };

    const handleSignupInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setSignupData(prev => ({ ...prev, [name]: value }));
    };

    const handleSignup = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (!signupData.id || !signupData.name || !signupData.password) {
            setError("All fields are required for signup.");
            return;
        }

        const users: User[] = JSON.parse(localStorage.getItem('users') || '[]');
        if (users.some(u => u.id === signupData.id)) {
            setError("User ID already exists. Please choose another one.");
            return;
        }

        const assessment = await assessNewUser(signupData);

        const newUser: User = {
            ...signupData,
            status: 'pending_approval',
            aiAssessment: assessment,
        };

        const updatedUsers = [...users, newUser];
        setUsers(updatedUsers);
        setIsLogin(true);
        addNotification("Registration successful! Your account is pending admin approval.", "info");
    };


    return (
        <div className="login-view-container">
            <div className="login-card">
                <div className="login-header">
                    <span className="logo">{Icons.logo}</span>
                    <h1>Academic AI Assistant</h1>
                </div>

                {isLogin ? (
                    <form onSubmit={handleLogin}>
                        <h2>Login</h2>
                        {error && <p className="auth-error">{error}</p>}
                        <div className="control-group">
                            <label htmlFor="loginId">User ID</label>
                            <input type="text" id="loginId" className="form-control" value={loginId} onChange={e => setLoginId(e.target.value)} required />
                        </div>
                        <div className="control-group">
                            <label htmlFor="password">Password</label>
                            <input type="password" id="password" className="form-control" value={password} onChange={e => setPassword(e.target.value)} required />
                        </div>
                        <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '0.8rem' }}>Login</button>
                        <p className="auth-toggle">
                            Don't have an account? <button type="button" onClick={() => { setIsLogin(false); setError(''); }}>Sign up</button>
                        </p>
                    </form>
                ) : (
                    <form onSubmit={handleSignup} className="signup-form">
                        <h2>Sign Up</h2>
                        {error && <p className="auth-error">{error}</p>}
                        <div className="control-group">
                            <label>Full Name</label>
                            <input type="text" name="name" className="form-control" value={signupData.name} onChange={handleSignupInputChange} required />
                        </div>
                        <div className="control-group">
                            <label>User ID</label>
                            <input type="text" name="id" className="form-control" value={signupData.id} onChange={handleSignupInputChange} required />
                        </div>
                        <div className="control-group">
                            <label>Password</label>
                            <input type="password" name="password" className="form-control" value={signupData.password} onChange={handleSignupInputChange} required />
                        </div>
                        <div className="control-group">
                            <label>Role</label>
                            <select name="role" className="form-control" value={signupData.role} onChange={handleSignupInputChange}>
                                <option value="student">Student</option>
                                <option value="faculty">Faculty</option>
                            </select>
                        </div>
                        <div className="control-group">
                            <label>Department</label>
                            <select name="dept" className="form-control" value={signupData.dept} onChange={handleSignupInputChange}>
                                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </div>
                        {signupData.role === 'student' &&
                            <div className="control-group">
                                <label>Year</label>
                                <select name="year" className="form-control" value={signupData.year} onChange={handleSignupInputChange}>
                                    {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                                </select>
                            </div>
                        }
                        <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '0.8rem' }}>Sign Up</button>
                        <p className="auth-toggle">
                            Already have an account? <button type="button" onClick={() => { setIsLogin(true); setError(''); }}>Login</button>
                        </p>
                    </form>
                )}
            </div>
        </div>
    );
};

// --- MAIN APP COMPONENT ---
const App = () => {
    // --- State Management ---
    const [theme, setTheme] = useLocalStorage('theme', 'light');
    const [isSidebarOpen, setSidebarOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    // Database state
    const [users, setUsers] = useDatabase<User[]>('users', MOCK_USERS);
    const [timetable, setTimetable] = useDatabase<TimetableEntry[]>('timetable', MOCK_TIMETABLE_DATA);
    const [announcements, setAnnouncements] = useDatabase<Announcement[]>('announcements', MOCK_ANNOUNCEMENTS);
    const [leaveRequests, setLeaveRequests] = useDatabase<LeaveRequest[]>('leaveRequests', MOCK_LEAVE_REQUESTS);
    const [resourceRequests, setResourceRequests] = useDatabase<ResourceRequest[]>('resourceRequests', MOCK_RESOURCE_REQUESTS);
    const [timeSlots, setTimeSlots] = useDatabase<string[]>('timeSlots', TIME_SLOTS_DEFAULT);

    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [view, setView] = useState<AppView>('home');
    const [isChatVisible, setIsChatVisible] = useState(false);
    const { addNotification } = useNotification();
    const [leaveRequestEntry, setLeaveRequestEntry] = useState<TimetableEntry | null>(null);

    // --- Effects ---
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
    }, [theme]);

    useEffect(() => {
        // Auto-login as admin for demonstration
        const adminUser = users.find(u => u.id === 'admin' && u.status === 'active');
        if (adminUser) {
            setCurrentUser(adminUser);
        }
        setIsLoading(false);
    }, []); // Empty dependency array ensures this runs only once on mount

    useEffect(() => {
        if (currentUser) {
            sessionStorage.setItem('currentUser', JSON.stringify(currentUser));
        } else {
            sessionStorage.removeItem('currentUser');
        }
    }, [currentUser]);

    // --- Handlers ---
    const toggleTheme = () => setTheme(theme === 'light' ? 'dark' : 'light');
    const handleLogout = () => {
        setCurrentUser(null);
        setView('home');
        setIsChatVisible(false); // Close chat on logout
    };
    const handleViewChange = (newView: AppView) => {
        setView(newView);
        setSidebarOpen(false); // Close sidebar on navigation
    };

    const handleLeaveRequestClick = (entry: TimetableEntry) => {
        setLeaveRequestEntry(entry);
    };


    // --- Render Logic ---
    if (isLoading) {
        return <div className="loading-fullscreen">Loading...</div>;
    }

    if (!currentUser) {
        return <AuthView setUsers={setUsers} setCurrentUser={setCurrentUser} addNotification={addNotification} />;
    }

    const availableViews = Object.entries(APP_VIEWS_CONFIG)
        .filter(([key, config]) => config.roles.includes(currentUser.role))
        .map(([key]) => key as AppView);

    const renderView = () => {
        const currentView = availableViews.includes(view) ? view : availableViews[0] || 'home';
        
        if (view !== currentView) {
            setView(currentView);
            return null;
        }

        switch (currentView) {
            case 'dashboard':
                return <DashboardView user={currentUser} timetable={timetable} leaveRequests={leaveRequests} allUsers={users} resourceRequests={resourceRequests} setResourceRequests={setResourceRequests} addNotification={addNotification} />;
            case 'timetable':
                return <TimetableView user={currentUser} timetable={timetable} leaveRequests={leaveRequests} onCellClick={handleLeaveRequestClick} />;
            case 'manage':
                return <ManageTimetableView timetable={timetable} setTimetable={setTimetable} allUsers={users} timeSlots={timeSlots} addNotification={addNotification} />;
            case 'settings':
                return <SettingsView timeSlots={timeSlots} setTimeSlots={setTimeSlots} allUsers={users} setAllUsers={setUsers} announcements={announcements} setAnnouncements={setAnnouncements} addNotification={addNotification} />;
            case 'approvals':
                return <ApprovalsView leaveRequests={leaveRequests} setLeaveRequests={setLeaveRequests} allUsers={users} timetable={timetable} addNotification={addNotification} />;
            case 'announcements':
                return <AnnouncementsView user={currentUser} announcements={announcements} setAnnouncements={setAnnouncements} addNotification={addNotification} />;
            case 'studentDirectory':
                return <StudentDirectoryView allUsers={users} resourceRequests={resourceRequests} setResourceRequests={setResourceRequests} addNotification={addNotification} />;
            default:
                // Simple role-based home for now
                return <div className="home-view-container">Welcome, {currentUser.name}! This is the home page.</div>;
        }
    };

    const pendingApprovalsCount = leaveRequests.filter(lr => lr.status === 'pending').length
        + (currentUser.role === 'admin' ? users.filter(u => u.status === 'pending_approval').length : 0);


    return (
        <div className={`app-container ${isSidebarOpen ? 'sidebar-open' : ''}`}>
            <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
                <div className="sidebar-header">
                    <span className="logo">{Icons.logo}</span>
                    <h1>Academic AI</h1>
                    <button className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar">{Icons.close}</button>
                </div>
                <nav>
                    <ul className="nav-list">
                        {availableViews.map(viewKey => (
                            <li key={viewKey} className="nav-item">
                                <button
                                    className={view === viewKey ? 'active' : ''}
                                    onClick={() => handleViewChange(viewKey)}
                                >
                                    {Icons[APP_VIEWS_CONFIG[viewKey].icon]}
                                    <span>{APP_VIEWS_CONFIG[viewKey].title}</span>
                                    {viewKey === 'approvals' && pendingApprovalsCount > 0 &&
                                        <span className="notification-badge">{pendingApprovalsCount}</span>
                                    }
                                </button>
                            </li>
                        ))}
                    </ul>
                </nav>
                <div className="sidebar-footer" style={{ marginTop: 'auto' }}>
                    <ul className="nav-list">
                        <li className="nav-item">
                            <button onClick={handleLogout}>
                                {Icons.logout}
                                <span>Logout</span>
                            </button>
                        </li>
                    </ul>
                </div>
            </aside>
            <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)}></div>

            <main className="main-content">
                <header className="header">
                    <button className="menu-toggle" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar">{Icons.manage}</button>
                    <h2>{APP_VIEWS_CONFIG[view as AppView]?.title || 'Academic Assistant'}</h2>
                    <div className="header-actions">
                        <div className="user-info">
                            <strong>{currentUser.name}</strong> ({currentUser.role})
                        </div>
                        <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
                            {theme === 'light' ? Icons.moon : Icons.sun}
                        </button>
                    </div>
                </header>
                <div className="page-content">
                    {renderView()}
                </div>
            </main>

            {isAiEnabled &&
                <Chatbot
                    user={currentUser}
                    isVisible={isChatVisible}
                    onToggle={() => setIsChatVisible(p => !p)}
                    timetable={timetable}
                />
            }
            {leaveRequestEntry && (
                <LeaveRequestModal
                    entry={leaveRequestEntry}
                    user={currentUser}
                    onClose={() => setLeaveRequestEntry(null)}
                    setLeaveRequests={setLeaveRequests}
                    addNotification={addNotification}
                />
            )}
        </div>
    );
};


const root = createRoot(document.getElementById('root')!);

root.render(
    <React.StrictMode>
        <NotificationProvider>
            <App />
        </NotificationProvider>
    </React.StrictMode>
);