/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Chat } from "@google/genai";
import { marked } from 'marked';

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
}
type DaySchedule = Period[];
type TimetableData = Record<string, Record<string, DaySchedule[]>>;
type UserRole = 'student' | 'faculty' | 'hod' | 'admin';
type AppView = 'dashboard' | 'timetable' | 'manage' | 'settings';
interface ManageFormData {
    department: string;
    year: string;
    day: string;
    timeIndex: number;
    subject: string;
    type: 'break' | 'class' | 'common';
}

const defaultTimeSlots = [
    "08:50 - 09:40", "09:40 - 10:30", "10:30 - 10:50", "10:50 - 11:40",
    "11:40 - 12:25", "12:25 - 01:05", "01:05 - 02:00", "02:00 - 02:50",
    "02:50 - 03:00", "03:00 - 03:50"
];
const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const departments = ["CSE", "ECE", "EEE"];
const years = ["Year 1", "Year 2", "Year 3", "Year 4"];
const privilegedRoles: UserRole[] = ['faculty', 'hod', 'admin'];

// --- DATABASE HELPERS (IndexedDB) ---
const DB_NAME = 'AcademiaAI_DB';
const DB_VERSION = 2; // Incremented version for schema change
const TIMETABLE_STORE = 'timetable';
const SETTINGS_STORE = 'settings';

const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject("Error opening DB");
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(TIMETABLE_STORE)) {
                db.createObjectStore(TIMETABLE_STORE, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
                db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
            }
        };
    });
};

const getSetting = <T,>(key: string): Promise<T | undefined> => {
    return new Promise(async (resolve, reject) => {
        const db = await openDB();
        const transaction = db.transaction(SETTINGS_STORE, 'readonly');
        const store = transaction.objectStore(SETTINGS_STORE);
        const request = store.get(key);
        request.onerror = () => reject(`Error fetching setting: ${key}`);
        request.onsuccess = () => resolve(request.result?.value);
    });
};

const setSetting = <T,>(key: string, value: T): Promise<void> => {
    return new Promise(async (resolve, reject) => {
        const db = await openDB();
        const transaction = db.transaction(SETTINGS_STORE, 'readwrite');
        const store = transaction.objectStore(SETTINGS_STORE);
        const request = store.put({ key, value });
        request.onerror = () => reject(`Error setting: ${key}`);
        request.onsuccess = () => resolve();
    });
};


const getAllEntries = (): Promise<TimetableEntry[]> => {
    return new Promise(async (resolve, reject) => {
        const db = await openDB();
        const transaction = db.transaction(TIMETABLE_STORE, 'readonly');
        const store = transaction.objectStore(TIMETABLE_STORE);
        const request = store.getAll();
        request.onerror = () => reject("Error fetching entries");
        request.onsuccess = () => resolve(request.result);
    });
};

const addEntry = (entry: TimetableEntry): Promise<void> => {
    return new Promise(async (resolve, reject) => {
        const db = await openDB();
        const transaction = db.transaction(TIMETABLE_STORE, 'readwrite');
        const store = transaction.objectStore(TIMETABLE_STORE);
        const request = store.add(entry);
        request.onerror = () => reject("Error adding entry");
        request.onsuccess = () => resolve();
    });
}

const updateEntry = (entry: TimetableEntry): Promise<void> => {
    return new Promise(async (resolve, reject) => {
        const db = await openDB();
        const transaction = db.transaction(TIMETABLE_STORE, 'readwrite');
        const store = transaction.objectStore(TIMETABLE_STORE);
        const request = store.put(entry);
        request.onerror = () => reject("Error updating entry");
        request.onsuccess = () => resolve();
    });
};

const deleteEntry = (id: string): Promise<void> => {
     return new Promise(async (resolve, reject) => {
        const db = await openDB();
        const transaction = db.transaction(TIMETABLE_STORE, 'readwrite');
        const store = transaction.objectStore(TIMETABLE_STORE);
        const request = store.delete(id);
        request.onerror = () => reject("Error deleting entry");
        request.onsuccess = () => resolve();
    });
};

const initDB = async (initialData: TimetableEntry[]) => {
    const entries = await getAllEntries();
    if (entries.length === 0) {
        const db = await openDB();
        const transaction = db.transaction(TIMETABLE_STORE, 'readwrite');
        const store = transaction.objectStore(TIMETABLE_STORE);
        initialData.forEach(entry => store.add(entry));
    }
};

// --- DATA TRANSFORMATION ---
const sampleTimetableToFlat = (): TimetableEntry[] => {
    const flatData: TimetableEntry[] = [];
    const sampleTimetable: TimetableData = { // Original nested data
        "CSE": {
            "Year 1": [],
            "Year 2": [
                [ { subject: "DSA", faculty: "Dr. A" }, { subject: "DBMS", faculty: "Dr. B" }, { subject: "Morning Break", type: 'break' }, { subject: "COA", faculty: "Dr. C" }, { subject: "OS", faculty: "Dr. D" }, { subject: "SE", faculty: "Dr. E" }, { subject: "Lunch Break", type: 'break' }, { subject: "NET Lab", type: 'common', faculty: "Dr. F" }, { subject: "Afternoon Break", type: 'break' }, { subject: "Maths IV", faculty: "Dr. G" } ],
                [ { subject: "OS", faculty: "Dr. D" }, { subject: "Maths IV", faculty: "Dr. G" }, { subject: "Morning Break", type: 'break' }, { subject: "SE", faculty: "Dr. E" }, { subject: "DSA", faculty: "Dr. A" }, { subject: "DBMS", faculty: "Dr. B" }, { subject: "Lunch Break", type: 'break' }, { subject: "COA", faculty: "Dr. C" }, { subject: "Afternoon Break", type: 'break' }, { subject: "NSS", type: 'common' } ],
                [ { subject: "SE", faculty: "Dr. E" }, { subject: "COA", faculty: "Dr. C" }, { subject: "Morning Break", type: 'break' }, { subject: "Maths IV", faculty: "Dr. G" }, { subject: "OS", faculty: "Dr. D" }, { subject: "DSA", faculty: "Dr. A" }, { subject: "Lunch Break", type: 'break' }, { subject: "DBMS", faculty: "Dr. B" }, { subject: "Afternoon Break", type: 'break' }, { subject: "LIB", type: 'common' } ],
                [ { subject: "DBMS", faculty: "Dr. B" }, { subject: "SE", faculty: "Dr. E" }, { subject: "Morning Break", type: 'break' }, { subject: "OS", faculty: "Dr. D" }, { subject: "COA", faculty: "Dr. C" }, { subject: "Maths IV", faculty: "Dr. G" }, { subject: "Lunch Break", type: 'break' }, { subject: "DSA", faculty: "Dr. A" }, { subject: "Afternoon Break", type: 'break' }, { subject: "NET Lab", type: 'common', faculty: "Dr. F" } ],
                [ { subject: "COA", faculty: "Dr. C" }, { subject: "DSA", faculty: "Dr. A" }, { subject: "Morning Break", type: 'break' }, { subject: "DBMS", faculty: "Dr. B" }, { subject: "Maths IV", faculty: "Dr. G" }, { subject: "SE", faculty: "Dr. E" }, { subject: "Lunch Break", type: 'break' }, { subject: "OS", faculty: "Dr. D" }, { subject: "Afternoon Break", type: 'break' }, { subject: "NSS", type: 'common' } ],
            ]
        },
        "ECE": {
             "Year 2": [
                [ { subject: "Signals", faculty: "Prof. X" }, { subject: "Circuits", faculty: "Prof. Y" }, { subject: "Morning Break", type: 'break' }, { subject: "Digital", faculty: "Prof. Z" }, { subject: "EMF", faculty: "Prof. X" }, { subject: "Maths III" }, { subject: "Lunch Break", type: 'break' }, { subject: "LIB", type: 'common' }, { subject: "Afternoon Break", type: 'break' }, { subject: "Control Sys" } ],
                [ { subject: "Digital", faculty: "Prof. Z" }, { subject: "EMF", faculty: "Prof. X" }, { subject: "Morning Break", type: 'break' }, { subject: "Signals", faculty: "Prof. X" }, { subject: "Circuits", faculty: "Prof. Y" }, { subject: "Maths III" }, { subject: "Lunch Break", type: 'break' }, { subject: "Control Sys" }, { subject: "Afternoon Break", type: 'break' }, { subject: "NET Lab", type: 'common' } ],
                [ { subject: "Circuits", faculty: "Prof. Y" }, { subject: "Control Sys" }, { subject: "Morning Break", type: 'break' }, { subject: "Maths III" }, { subject: "Digital", faculty: "Prof. Z" }, { subject: "EMF", faculty: "Prof. X" }, { subject: "Lunch Break", type: 'break' }, { subject: "Signals", faculty: "Prof. X" }, { subject: "Afternoon Break", type: 'break' }, { subject: "NSS", type: 'common' } ],
            ]
        },
    };
    for (const dept in sampleTimetable) {
        for (const year in sampleTimetable[dept]) {
            sampleTimetable[dept][year].forEach((daySchedule, dayIndex) => {
                daySchedule.forEach((period, timeIndex) => {
                    const day = days[dayIndex];
                    const id = `${dept}_${year}_${day}_${timeIndex}`.replace(/\s+/g, '-');
                    flatData.push({
                        id,
                        department: dept,
                        year: year,
                        day,
                        timeIndex,
                        subject: period.subject,
                        type: period.type || 'class',
                        faculty: period.faculty
                    });
                });
            });
        }
    }
    return flatData;
}

const transformEntriesToNested = (entries: TimetableEntry[], timeSlots: string[]): TimetableData => {
    const nested: TimetableData = {};
    entries.forEach(entry => {
        if (!nested[entry.department]) nested[entry.department] = {};
        if (!nested[entry.department][entry.year]) {
            nested[entry.department][entry.year] = days.map(() => new Array(timeSlots.length).fill(null));
        }
        const dayIndex = days.indexOf(entry.day);
        if (dayIndex !== -1 && entry.timeIndex < timeSlots.length) {
            nested[entry.department][entry.year][dayIndex][entry.timeIndex] = {
                subject: entry.subject,
                type: entry.type,
                faculty: entry.faculty
            };
        }
    });
    // Ensure all year groups have the correct number of slots
    for (const dept in nested) {
        for (const year in nested[dept]) {
            nested[dept][year] = nested[dept][year].map(daySchedule => {
                const newDaySchedule = [...daySchedule];
                if (newDaySchedule.length < timeSlots.length) {
                    newDaySchedule.length = timeSlots.length;
                    newDaySchedule.fill(null, daySchedule.length);
                }
                return newDaySchedule;
            });
        }
    }
    return nested;
};

// --- COMPONENTS ---

const Icon = ({ name }: { name: string }) => {
    const icons: Record<string, JSX.Element> = {
        dashboard: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></svg>,
        timetable: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0h18M-4.5 12h22.5" /></svg>,
        manage: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" /></svg>,
        settings: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-1.007 1.11-1.226l.28-.1c.34-.125.702-.125 1.042 0l.28.1c.548.22 1.02.684 1.11 1.226l.068.418c.22.642.664 1.18 1.217 1.488l.278.155a.522.522 0 0 1 .553 0l.278-.155c.553-.308.997-.846 1.217-1.488l.068-.418c.09-.542.56-1.007 1.11-1.226l.28-.1c.34-.125.702-.125 1.042 0l.28.1c.548.22 1.02.684 1.11 1.226l.068.418c.22.642.664 1.18 1.217 1.488l.278.155a.522.522 0 0 1 .553 0l.278-.155c.553-.308.997-.846 1.217-1.488l.068-.418c.09-.542.56-1.007 1.11-1.226l.28-.1c.34-.125.702-.125 1.042 0l.28.1c.548.22 1.02.684 1.11 1.226l.068.418c.22.642.664 1.18 1.217 1.488l.278.155a.522.522 0 0 1 0 .553l-.278.155c-.553.308-1.217.846-1.488 1.217l-.418.068c-.542.09-1.007.56-1.226 1.11l-.1.28c-.125.34-.125.702 0 1.042l.1.28c.22.548.684 1.02 1.226 1.11l.418.068c.642.22 1.18.664 1.488 1.217l.155.278a.522.522 0 0 1 0 .553l-.155.278c-.308.553-.846 1.217-1.488-1.217l-.418.068c-.542.09-1.007.56-1.226 1.11l-.1.28c-.125.34-.125.702 0 1.042l.1.28c.22.548.684 1.02 1.226 1.11l.418.068c.642.22 1.18.664 1.488 1.217l.155.278a.522.522 0 0 1-.553.553l-.278-.155c-.553-.308-1.217-.846-1.488-1.217l-.418-.068c-.542-.09-1.007-.56-1.226-1.11l-.1-.28a1.042 1.042 0 0 0-1.042 0l-.1.28c-.22.548-.684 1.02-1.226 1.11l-.418.068c-.642-.22-1.18-.664-1.488-1.217l-.155.278a.522.522 0 0 1-.553 0l-.155-.278c-.308-.553-.846-1.217-1.488-1.217l-.418-.068c-.542-.09-1.007-.56-1.226-1.11l-.1-.28a1.042 1.042 0 0 0-1.042 0l-.1.28c-.22.548-.684 1.02-1.226 1.11l-.418.068c-.642-.22-1.18-.664-1.488-1.217l-.155.278a.522.522 0 0 1-.553-.553l.155-.278c.308-.553.846-1.217 1.217-1.488l.068-.418c.09-.542.56-1.007 1.11-1.226l.28-.1c.34-.125.702-.125 1.042 0l.28.1c.548.22 1.02.684 1.11 1.226l.068.418c.22.642.664 1.18 1.217 1.488l.278.155a.522.522 0 0 1 .553 0l.278-.155c.553-.308.997-.846 1.217-1.488l.068-.418c.09-.542.56-1.007 1.11-1.226l.28-.1c.34-.125.702-.125 1.042 0l.28.1c.548.22 1.02.684 1.11 1.226l.068.418c.22.642.664 1.18 1.217 1.488l.278.155a.522.522 0 0 1 0 .553l-.278.155c-.553-.308-.997.846-1.217 1.488l-.068.418c-.09.542-.56 1.007-1.11 1.226l-.28.1c-.34.125-.702-.125-1.042 0l-.28-.1c-.548-.22-1.02-.684-1.11-1.226l-.068-.418c-.22-.642-.664-1.18-1.217-1.488l-.278-.155a.522.522 0 0 1-.553 0l-.278.155c-.553-.308-.997.846-1.217 1.488l-.068.418c-.09.542-.56 1.007-1.11 1.226l-.28.1c-.34.125-.702.125-1.042 0l-.28-.1c-.548-.22-1.02-.684-1.11-1.226l-.068-.418c-.22-.642-.664-1.18-1.217-1.488l-.278-.155a.522.522 0 0 1 0-.553l.278-.155c.553-.308 1.217-.846 1.488-1.217l.418-.068c.542-.09 1.007-.56 1.226-1.11l.1-.28c.125-.34.125-.702 0-1.042l-.1-.28c-.22-.548-.684-1.02-1.226-1.11l-.418-.068c-.642-.22-1.18-.664-1.488-1.217l-.155-.278a.522.522 0 0 1 0-.553l.155-.278c.308-.553.846-1.217 1.488-1.217l.418.068c.542.09 1.007.56 1.226 1.11l.1.28c.125.34.125.702 0 1.042l-.1.28c-.22.548-.684-1.02-1.226-1.11l-.418-.068c-.642-.22-1.18-.664-1.488-1.217l-.155-.278a.522.522 0 0 1 .553-.553l.278.155c.553.308 1.217.846 1.488 1.217l.418.068c.542.09 1.007.56 1.226 1.11l.1.28c.125.34.125.702 0 1.042l-.1.28c-.22.548-.684 1.02-1.226 1.11l-.418.068c-.642-.22-1.18-.664-1.488-1.217l-.155-.278a.522.522 0 0 1 0-.553l.155-.278c.308-.553.846-1.217 1.217-1.488l.068-.418c.09-.542.56-1.007 1.11-1.226l.28-.1zM12 15.75a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5z" /></svg>,
        edit: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" /></svg>,
        delete: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.134-2.09-2.134H8.09c-1.18 0-2.09.954-2.09 2.134v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>,
        save: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>,
        cancel: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>,
        sun: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" /></svg>,
        moon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" /></svg>,
        chat: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.76 9.76 0 01-2.53-.388m-5.383-.948a.75.75 0 00-.011.022l-.087.42-.087.42-.087.419m.264-.859A3.734 3.734 0 016.75 15.75c-1.332 0-2.505-.726-3.132-1.812a.75.75 0 00-.79-.412m-2.132 1.352a.75.75 0 00.214.214l.214.214.214.214.214.214.314-1.572a.75.75 0 00-.428-.888C3.386 15.64 3 14.862 3 14.25c0-1.84.992-3.47 2.459-4.414A9.753 9.753 0 0112 3c4.97 0 9 3.694 9 8.25z" /></svg>,
        send: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>,
        menu: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg>,
        users: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-4.663M12 12a3 3 0 100-6 3 3 0 000 6z" /></svg>,
        bell: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" /></svg>,
        'check-circle': <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
        'building': <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h6M9 11.25h6M9 15.75h6M9 20.25h6" /></svg>,
    };
    return icons[name] || null;
};

const ThemeToggle = ({ theme, toggleTheme }: { theme: string, toggleTheme: () => void }) => (
    <button onClick={toggleTheme} className="theme-toggle" aria-label="Toggle theme">
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
);

const Sidebar = ({ currentView, setView, hasPrivilege, isOpen, onClose }: { currentView: AppView, setView: (view: AppView) => void, hasPrivilege: boolean, isOpen: boolean, onClose: () => void }) => {
    const handleLinkClick = (view: AppView) => {
        setView(view);
        onClose();
    };
    
    return (
        <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
            <div className="sidebar-header">
                <div className="logo"><Icon name="timetable" /></div>
                <h1>Academia AI</h1>
                <button className="sidebar-close" onClick={onClose} aria-label="Close menu">
                    <Icon name="cancel" />
                </button>
            </div>
            <nav>
                <ul className="nav-list">
                    <li className="nav-item">
                        <a href="#" className={currentView === 'dashboard' ? 'active' : ''} onClick={() => handleLinkClick('dashboard')}>
                            <Icon name="dashboard" />
                            <span>Dashboard</span>
                        </a>
                    </li>
                    <li className="nav-item">
                        <a href="#" className={currentView === 'timetable' ? 'active' : ''} onClick={() => handleLinkClick('timetable')}>
                            <Icon name="timetable" />
                            <span>Timetable</span>
                        </a>
                    </li>
                    {hasPrivilege && (
                        <>
                            <li className="nav-item">
                                <a href="#" className={currentView === 'manage' ? 'active' : ''} onClick={() => handleLinkClick('manage')}>
                                    <Icon name="manage" />
                                    <span>Manage</span>
                                </a>
                            </li>
                            <li className="nav-item">
                                <a href="#" className={currentView === 'settings' ? 'active' : ''} onClick={() => handleLinkClick('settings')}>
                                    <Icon name="settings" />
                                    <span>Settings</span>
                                </a>
                            </li>
                        </>
                    )}
                </ul>
            </nav>
        </aside>
    );
};


const Header = ({ title, role, setRole, theme, toggleTheme, onMenuClick }: { title: string, role: UserRole, setRole: (role: UserRole) => void, theme: string, toggleTheme: () => void, onMenuClick: () => void }) => (
    <header className="header">
        <button className="menu-toggle" onClick={onMenuClick} aria-label="Open menu">
            <Icon name="menu" />
        </button>
        <h2>{title}</h2>
        <div className="header-actions">
            <div className="role-switcher">
                 <label htmlFor="role-select">Role:</label>
                <select id="role-select" value={role} onChange={(e) => setRole(e.target.value as UserRole)} className="form-control">
                    <option value="student">Student</option>
                    <option value="faculty">Faculty</option>
                    <option value="hod">HOD</option>
                    <option value="admin">Admin</option>
                </select>
            </div>
            <ThemeToggle theme={theme} toggleTheme={toggleTheme} />
        </div>
    </header>
);

const EditModal = ({ entry, onSave, onCancel, timeSlots }: { entry: TimetableEntry, onSave: (updatedEntry: TimetableEntry) => void, onCancel: () => void, timeSlots: string[] }) => {
    const [formData, setFormData] = useState(entry);
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        const timer = requestAnimationFrame(() => setIsOpen(true));
        return () => cancelAnimationFrame(timer);
    }, []);

    const handleClose = (callback: () => void) => {
        setIsOpen(false);
        setTimeout(callback, 300); // Match CSS transition duration
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        handleClose(() => onSave(formData));
    };

    const day = entry.day;
    const time = timeSlots[entry.timeIndex];

    return (
        <div className={`modal-overlay ${isOpen ? 'open' : ''}`}>
            <div className="modal-content">
                <h3>Edit Period</h3>
                <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>
                    Editing for {entry.department} - {entry.year} <br/>
                    {day} at {time}
                </p>
                <form onSubmit={handleSubmit}>
                     <div className="control-group" style={{marginBottom: '1rem'}}>
                        <label htmlFor="type">Type</label>
                        <select id="type" name="type" value={formData.type} onChange={handleChange} className="form-control">
                            <option value="class">Class</option>
                            <option value="break">Break</option>
                            <option value="common">Common</option>
                        </select>
                    </div>
                    <div className="control-group">
                        <label htmlFor="subject">Subject / Activity</label>
                        <input
                            type="text"
                            id="subject"
                            name="subject"
                            value={formData.subject}
                            onChange={handleChange}
                            className="form-control"
                            required
                        />
                    </div>
                    <div className="form-actions">
                        <button type="button" className="btn btn-secondary" onClick={() => handleClose(onCancel)}>Cancel</button>
                        <button type="submit" className="btn btn-primary">Save Changes</button>
                    </div>
                </form>
            </div>
        </div>
    );
};


const TimetableView = ({ data, timeSlots, onCellClick, department, year, setDepartment, setYear, hasPrivilege, editMode, setEditMode }: { data: TimetableData, timeSlots: string[], onCellClick: (entry: TimetableEntry) => void, department: string, year: string, setDepartment: (d: string) => void, setYear: (y: string) => void, hasPrivilege: boolean, editMode: boolean, setEditMode: (e: boolean) => void }) => {
    const schedule = data[department]?.[year] || days.map(() => new Array(timeSlots.length).fill(null));

    return (
        <div>
            <div className="timetable-header">
                <div className="timetable-controls">
                     <select value={department} onChange={e => setDepartment(e.target.value)} className="form-control">
                        {departments.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <select value={year} onChange={e => setYear(e.target.value)} className="form-control">
                        {years.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                </div>
                 {hasPrivilege && (
                    <div className="edit-mode-toggle">
                        <span>Edit Mode</span>
                        <label className="switch">
                            <input type="checkbox" checked={editMode} onChange={() => setEditMode(!editMode)} />
                            <span className="slider"></span>
                        </label>
                    </div>
                )}
            </div>
            <div className="timetable-grid" style={{ gridTemplateColumns: `80px repeat(${days.length}, 1fr)`}}>
                <div className="grid-header">Time</div>
                {days.map(day => <div key={day} className="grid-header">{day}</div>)}

                {timeSlots.map((slot, timeIndex) => (
                    <React.Fragment key={timeIndex}>
                        <div className="time-slot">
                            <span>{slot.split(' - ')[0]}</span>
                            <span>{slot.split(' - ')[1]}</span>
                        </div>
                        {days.map((day, dayIndex) => {
                            const period = schedule[dayIndex]?.[timeIndex];
                            const cellClass = `grid-cell ${period?.type || ''} ${editMode ? 'editable' : ''}`.trim();

                            const handleCellClick = () => {
                                if (!editMode) return;
                                const existingEntry: TimetableEntry = {
                                    id: `${department}_${year}_${day}_${timeIndex}`.replace(/\s+/g, '-'),
                                    department,
                                    year,
                                    day,
                                    timeIndex,
                                    subject: period?.subject || '',
                                    type: period?.type || 'class'
                                };
                                onCellClick(existingEntry);
                            };

                            return (
                                <div key={`${day}-${timeIndex}`} className={cellClass} onClick={handleCellClick}>
                                    {period ? (
                                        <>
                                            <span className="subject">{period.subject}</span>
                                            {period.faculty && <span className="faculty">{period.faculty}</span>}
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

const ManageTimetableView = ({ entries, onAdd, onUpdate, onDelete, timeSlots }: { entries: TimetableEntry[], onAdd: (entry: Omit<TimetableEntry, 'id'>) => Promise<void>, onUpdate: (entry: TimetableEntry) => void, onDelete: (id: string) => void, timeSlots: string[] }) => {
    const initialFormState: ManageFormData = {
        department: departments[0],
        year: years[0],
        day: days[0],
        timeIndex: 0,
        subject: '',
        type: 'class'
    };
    const [formData, setFormData] = useState<ManageFormData>(initialFormState);
    const [editingId, setEditingId] = useState<string | null>(null);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        const processedValue = name === 'timeIndex' ? parseInt(value, 10) : value;
        setFormData(prev => ({ ...prev, [name]: processedValue }));
    };

    const handleReset = () => {
        setFormData(initialFormState);
        setEditingId(null);
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (editingId) {
            onUpdate({ id: editingId, ...formData });
        } else {
            await onAdd(formData);
        }
        handleReset();
    };
    
    const handleEdit = (entry: TimetableEntry) => {
        setEditingId(entry.id);
        setFormData({
            department: entry.department,
            year: entry.year,
            day: entry.day,
            timeIndex: entry.timeIndex,
            subject: entry.subject,
            type: entry.type
        });
    }

    return (
        <div className="manage-timetable-container">
            <div className="entry-form">
                <h3>{editingId ? 'Edit Entry' : 'Add New Entry'}</h3>
                <form onSubmit={handleSubmit}>
                    <div className="form-grid">
                        <div className="control-group">
                            <label htmlFor="department">Department</label>
                            <select name="department" id="department" value={formData.department} onChange={handleChange} className="form-control">
                                {departments.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </div>
                        <div className="control-group">
                            <label htmlFor="year">Year</label>
                            <select name="year" id="year" value={formData.year} onChange={handleChange} className="form-control">
                                {years.map(y => <option key={y} value={y}>{y}</option>)}
                            </select>
                        </div>
                        <div className="control-group">
                            <label htmlFor="day">Day</label>
                            <select name="day" id="day" value={formData.day} onChange={handleChange} className="form-control">
                                {days.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </div>
                        <div className="control-group">
                            <label htmlFor="timeIndex">Time Slot</label>
                            <select name="timeIndex" id="timeIndex" value={formData.timeIndex} onChange={handleChange} className="form-control">
                                {timeSlots.map((ts, i) => <option key={i} value={i}>{ts}</option>)}
                            </select>
                        </div>
                         <div className="control-group">
                            <label htmlFor="type">Type</label>
                            <select name="type" id="type" value={formData.type} onChange={handleChange} className="form-control">
                                <option value="class">Class</option>
                                <option value="break">Break</option>
                                <option value="common">Common Activity</option>
                            </select>
                        </div>
                        <div className="control-group">
                            <label htmlFor="subject">Subject / Activity Name</label>
                            <input type="text" name="subject" id="subject" value={formData.subject} onChange={handleChange} className="form-control" required />
                        </div>
                    </div>
                    <div className="form-actions">
                        {editingId && <button type="button" onClick={handleReset} className="btn btn-secondary">Cancel Edit</button>}
                        <button type="submit" className="btn btn-primary">{editingId ? 'Update Entry' : 'Add Entry'}</button>
                    </div>
                </form>
            </div>

            <div className="entry-list-container">
                <h3>Existing Entries</h3>
                <div style={{ overflowX: 'auto' }}>
                    <table className="entry-list-table">
                        <thead>
                            <tr>
                                <th>Dept</th>
                                <th>Year</th>
                                <th>Day</th>
                                <th>Time</th>
                                <th>Subject</th>
                                <th>Type</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {entries.sort((a,b) => a.id.localeCompare(b.id)).map(entry => (
                                <tr key={entry.id}>
                                    <td>{entry.department}</td>
                                    <td>{entry.year}</td>
                                    <td>{entry.day}</td>
                                    <td>{timeSlots[entry.timeIndex]}</td>
                                    <td>{entry.subject}</td>
                                    <td>{entry.type}</td>
                                    <td className="entry-actions">
                                        <button onClick={() => handleEdit(entry)} title="Edit"><Icon name="edit" /></button>
                                        <button onClick={() => onDelete(entry.id)} title="Delete" className="delete-btn"><Icon name="delete" /></button>
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

const SettingsView = ({ timeSlots, setTimeSlots }: { timeSlots: string[], setTimeSlots: (slots: string[]) => void }) => {
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [editingValue, setEditingValue] = useState('');
    const [newTimeSlot, setNewTimeSlot] = useState('');

    const handleEdit = (index: number) => {
        setEditingIndex(index);
        setEditingValue(timeSlots[index]);
    };

    const handleSave = (index: number) => {
        const updatedSlots = [...timeSlots];
        updatedSlots[index] = editingValue;
        setTimeSlots(updatedSlots);
        setEditingIndex(null);
    };

    const handleDelete = (index: number) => {
        const updatedSlots = timeSlots.filter((_, i) => i !== index);
        setTimeSlots(updatedSlots);
    };

    const handleAdd = (e: React.FormEvent) => {
        e.preventDefault();
        if (newTimeSlot.trim()) {
            setTimeSlots([...timeSlots, newTimeSlot.trim()]);
            setNewTimeSlot('');
        }
    };

    return (
        <div className="settings-container">
            <h2>Settings</h2>
            <div className="settings-card">
                <h3>Manage Time Slots</h3>
                <ul className="timeslot-list">
                    {timeSlots.map((slot, index) => (
                        <li key={index} className="timeslot-item">
                            {editingIndex === index ? (
                                <>
                                    <input
                                        type="text"
                                        value={editingValue}
                                        onChange={(e) => setEditingValue(e.target.value)}
                                        className="form-control"
                                    />
                                    <div className="item-actions">
                                        <button onClick={() => handleSave(index)} title="Save"><Icon name="save"/></button>
                                        <button onClick={() => setEditingIndex(null)} title="Cancel"><Icon name="cancel"/></button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <span>{slot}</span>
                                    <div className="item-actions">
                                        <button onClick={() => handleEdit(index)} title="Edit"><Icon name="edit"/></button>
                                        <button onClick={() => handleDelete(index)} title="Delete" className="delete-btn"><Icon name="delete"/></button>
                                    </div>
                                </>
                            )}
                        </li>
                    ))}
                </ul>
                <form onSubmit={handleAdd} className="add-timeslot-form">
                    <input
                        type="text"
                        value={newTimeSlot}
                        onChange={(e) => setNewTimeSlot(e.target.value)}
                        placeholder="e.g., 04:00 - 05:00"
                        className="form-control"
                    />
                    <button type="submit" className="btn btn-primary">Add Slot</button>
                </form>
            </div>
        </div>
    );
};

const LiveClassTracker = ({ schedule, timeSlots }: { schedule: TimetableEntry[], timeSlots: string[] }) => {
    const [now, setNow] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 1000); // Update every second
        return () => clearInterval(timer);
    }, []);

    const parseTime = (timeStr: string) => {
        const [hours, minutes] = timeStr.split(':').map(Number);
        const date = new Date();
        date.setHours(hours, minutes, 0, 0);
        return date;
    };

    const status = useMemo(() => {
        let currentPeriod = null;
        let nextPeriod = null;

        for (const entry of schedule) {
            const timeSlot = timeSlots[entry.timeIndex];
            if (!timeSlot || !timeSlot.includes(' - ')) continue;

            const [startTimeStr, endTimeStr] = timeSlot.split(' - ');
            const startTime = parseTime(startTimeStr.trim());
            const endTime = parseTime(endTimeStr.trim());

            if (now >= startTime && now < endTime) {
                currentPeriod = { ...entry, startTime, endTime };
                break;
            }
            if (now < startTime && !nextPeriod) {
                nextPeriod = { ...entry, startTime, endTime };
            }
        }
        
        if (!currentPeriod && schedule.length > 0) {
            const lastEntry = schedule[schedule.length - 1];
            const lastTimeSlot = timeSlots[lastEntry.timeIndex];
            if (lastTimeSlot && lastTimeSlot.includes(' - ')) {
                const [_, lastEndTimeStr] = lastTimeSlot.split(' - ');
                const lastEndTime = parseTime(lastEndTimeStr.trim());
                if (now >= lastEndTime) {
                     return { type: 'ended', message: "Classes are done for today!" };
                }
            }
        }
        
        if (currentPeriod) {
            const totalDuration = currentPeriod.endTime.getTime() - currentPeriod.startTime.getTime();
            const elapsed = now.getTime() - currentPeriod.startTime.getTime();
            const remaining = currentPeriod.endTime.getTime() - now.getTime();
            const progress = Math.max(0, Math.min(100, (elapsed / totalDuration) * 100));
            return { type: 'current', period: currentPeriod, remaining, progress };
        }

        if (nextPeriod) {
            const countdown = nextPeriod.startTime.getTime() - now.getTime();
            return { type: 'next', period: nextPeriod, countdown };
        }

        return { type: 'none', message: "No upcoming classes today." };
    }, [now, schedule, timeSlots]);
    
    const formatMillis = (millis: number) => {
        const totalSeconds = Math.floor(millis / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        let parts = [];
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (hours === 0 && minutes < 10) parts.push(`${seconds}s`); // show seconds only for last few minutes
        return parts.join(' ') || '...';
    };

    const renderContent = () => {
        switch (status.type) {
            case 'current':
                return (
                    <>
                        <div className="status-badge current">ONGOING</div>
                        <h4>{status.period.subject}</h4>
                        <div className="time-info">
                            <span>Ends in: {formatMillis(status.remaining)}</span>
                            <span>{timeSlots[status.period.timeIndex]}</span>
                        </div>
                        <div className="progress-bar-container">
                            <div className="progress-bar" style={{ width: `${status.progress}%` }}></div>
                        </div>
                    </>
                );
            case 'next':
                return (
                    <>
                        <div className="status-badge next">UP NEXT</div>
                        <h4>{status.period.subject}</h4>
                         <div className="time-info">
                            <span>Starts in: {formatMillis(status.countdown)}</span>
                            <span>{timeSlots[status.period.timeIndex]}</span>
                        </div>
                    </>
                );
            case 'ended':
            case 'none':
                return (
                    <>
                        <div className="status-badge ended">IDLE</div>
                        <h4>{status.message}</h4>
                    </>
                );
            default:
                return null;
        }
    };
    
    return (
        <div className="dashboard-card live-tracker-card">
            {renderContent()}
        </div>
    );
};

// --- ROLE-SPECIFIC DASHBOARD COMPONENTS ---

const StudentDashboard = ({ entries, timeSlots, department, year, setDepartment, setYear }: { entries: TimetableEntry[], timeSlots: string[], department: string, year: string, setDepartment: (d: string) => void, setYear: (y: string) => void }) => {
    const today = new Date();
    const dayIndex = today.getDay() - 1;
    const currentDayName = days[dayIndex] || "Monday";

    const todaysSchedule = useMemo(() => entries
        .filter(e => e.department === department && e.year === year && e.day === currentDayName)
        .sort((a, b) => a.timeIndex - b.timeIndex), [entries, department, year, currentDayName]);
    
    return (
        <>
            <div className="timetable-header">
                <h3>Welcome, Student!</h3>
                <div className="timetable-controls">
                     <select value={department} onChange={e => setDepartment(e.target.value)} className="form-control">
                        {departments.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <select value={year} onChange={e => setYear(e.target.value)} className="form-control">
                        {years.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                </div>
            </div>
             <div className="dashboard-grid dashboard-student">
                <LiveClassTracker schedule={todaysSchedule} timeSlots={timeSlots} />
                <div className="dashboard-card" id="today-schedule">
                    <h3>Today's Schedule ({currentDayName})</h3>
                    {todaysSchedule.length > 0 ? (
                        <ul className="schedule-list">
                            {todaysSchedule.map(entry => (
                                <li key={entry.id} className={`schedule-item ${entry.type}`}>
                                    <span className="time">{timeSlots[entry.timeIndex]}</span>
                                    <span className="subject">{entry.subject}</span>
                                </li>
                            ))}
                        </ul>
                    ) : <p>No schedule found for today.</p>}
                </div>
                <div className="dashboard-card" id="announcements">
                    <h3><Icon name="bell"/> Announcements</h3>
                    <ul className="announcement-list">
                        <li>Mid-term exams start next week.</li>
                        <li>Tech Fest '24 registrations are now open.</li>
                        <li>Library will be closed this Saturday.</li>
                    </ul>
                </div>
            </div>
        </>
    )
};

const FacultyDashboard = ({ entries, timeSlots, department, year, setDepartment, setYear }: { entries: TimetableEntry[], timeSlots: string[], department: string, year: string, setDepartment: (d: string) => void, setYear: (y: string) => void }) => {
    const today = new Date();
    const dayIndex = today.getDay() - 1;
    const currentDayName = days[dayIndex] || "Monday";

     const todaysClasses = useMemo(() => entries
        .filter(e => e.department === department && e.day === currentDayName) // Simplified: shows all dept classes
        .sort((a, b) => a.timeIndex - b.timeIndex), [entries, department, currentDayName]);

    return (
        <>
            <div className="timetable-header">
                 <h3>Faculty Portal</h3>
                 <div className="timetable-controls">
                     <select value={department} onChange={e => setDepartment(e.target.value)} className="form-control" disabled>
                        {departments.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                </div>
            </div>
            <div className="dashboard-grid dashboard-faculty">
                 <LiveClassTracker schedule={todaysClasses} timeSlots={timeSlots} />
                 <div className="dashboard-card" id="faculty-schedule">
                    <h3>Your Classes Today</h3>
                    {todaysClasses.filter(c => c.type === 'class').length > 0 ? (
                         <ul className="schedule-list">
                            {todaysClasses.filter(c => c.type === 'class').map(entry => (
                                <li key={entry.id} className="schedule-item">
                                    <span className="time">{timeSlots[entry.timeIndex]}</span>
                                    <span><strong>{entry.subject}</strong> ({entry.year})</span>
                                </li>
                            ))}
                        </ul>
                    ) : <p>You have no classes scheduled for today.</p>}
                 </div>
                 <div className="dashboard-card quick-actions-card">
                     <h3><Icon name="edit"/> Quick Actions</h3>
                     <div className="action-buttons">
                        <button className="btn btn-secondary">Mark Attendance</button>
                        <button className="btn btn-secondary">Upload Notes</button>
                        <button className="btn btn-secondary">Post Announcement</button>
                     </div>
                 </div>
            </div>
        </>
    )
};

const HODDashboard = ({ entries, timeSlots, department, setDepartment }: { entries: TimetableEntry[], timeSlots: string[], department: string, setDepartment: (d: string) => void }) => {
    const today = new Date();
    const dayIndex = today.getDay() - 1;
    const currentDayName = days[dayIndex] || "Monday";
    
    const deptStats = useMemo(() => {
        const deptEntries = entries.filter(e => e.department === department);
        const faculty = new Set(deptEntries.map(e => e.faculty).filter(Boolean));
        return {
            totalPeriods: deptEntries.length,
            facultyCount: faculty.size,
            years: Array.from(new Set(deptEntries.map(e => e.year))).sort()
        }
    }, [entries, department]);

    const fullDaySchedule = useMemo(() => entries
        .filter(e => e.department === department && e.day === currentDayName)
        .sort((a, b) => a.timeIndex - b.timeIndex), [entries, department, currentDayName]);

    return (
         <>
            <div className="timetable-header">
                 <h3>Head of Department View</h3>
                 <div className="timetable-controls">
                     <select value={department} onChange={e => setDepartment(e.target.value)} className="form-control">
                        {departments.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                </div>
            </div>
            <div className="dashboard-grid dashboard-hod">
                <div className="dashboard-card" id="dept-at-a-glance">
                    <h3><Icon name="building"/> {department} At a Glance</h3>
                    <ul className="stats-list">
                        <li><strong>Total Periods/Week:</strong> <span>{deptStats.totalPeriods}</span></li>
                        <li><strong>Faculty Members:</strong> <span>{deptStats.facultyCount}</span></li>
                        <li><strong>Active Year Groups:</strong> <span>{deptStats.years.join(', ')}</span></li>
                    </ul>
                </div>
                 <div className="dashboard-card" id="approval-requests">
                    <h3><Icon name="check-circle"/> Approval Requests</h3>
                    <ul className="announcement-list">
                        <li>Dr. A requested leave for {days[4]}.</li>
                        <li>Request for schedule change in Year 2.</li>
                        <li className="no-requests">No other pending requests.</li>
                    </ul>
                </div>
                <div className="dashboard-card full-day-view">
                     <h3>Today's Full Schedule ({currentDayName})</h3>
                     <div className="schedule-table-wrapper">
                         <table className="schedule-table">
                             <thead>
                                 <tr>
                                     <th>Time</th>
                                     {years.map(y => <th key={y}>{y}</th>)}
                                 </tr>
                             </thead>
                             <tbody>
                                 {timeSlots.map((slot, timeIndex) => (
                                     <tr key={timeIndex}>
                                         <td>{slot.split(' - ')[0]}</td>
                                         {years.map(year => {
                                             const entry = fullDaySchedule.find(e => e.timeIndex === timeIndex && e.year === year);
                                             return <td key={year} className={entry?.type}>{entry?.subject || '-'}</td>
                                         })}
                                     </tr>
                                 ))}
                             </tbody>
                         </table>
                     </div>
                 </div>
            </div>
        </>
    )
};

const AdminDashboard = ({ entries, setView }: { entries: TimetableEntry[], setView: (v: AppView) => void }) => {
    const stats = useMemo(() => {
        const uniqueSubjects = new Set(entries.filter(e => e.type === 'class').map(e => e.subject));
        const departmentData = departments.map(dept => {
             const deptEntries = entries.filter(e => e.department === dept);
             return {
                 name: dept,
                 classCount: deptEntries.filter(e => e.type === 'class').length,
                 facultyCount: new Set(deptEntries.map(e => e.faculty).filter(Boolean)).size,
             }
        })
        return {
            totalEntries: entries.length,
            departments: new Set(entries.map(e => e.department)).size,
            years: new Set(entries.map(e => e.year)).size,
            subjects: uniqueSubjects.size,
            departmentData
        };
    }, [entries]);

    return (
        <>
            <div className="timetable-header">
                 <h3>Administrative Control Panel</h3>
            </div>
             <div className="dashboard-grid dashboard-admin">
                 <div className="dashboard-card system-stats-card">
                     <h3>System-Wide Statistics</h3>
                    <ul className="stats-list">
                        <li><strong>Total Timetable Entries:</strong> <span>{stats.totalEntries}</span></li>
                        <li><strong>Active Departments:</strong> <span>{stats.departments}</span></li>
                        <li><strong>Total Year Groups:</strong> <span>{stats.years}</span></li>
                        <li><strong>Unique Subjects Taught:</strong> <span>{stats.subjects}</span></li>
                    </ul>
                 </div>
                  <div className="dashboard-card quick-actions-card">
                     <h3><Icon name="settings"/> Administrative Tools</h3>
                     <div className="action-buttons">
                        <button className="btn btn-secondary" onClick={() => setView('manage')}>Manage Timetable</button>
                        <button className="btn btn-secondary" onClick={() => setView('settings')}>Configure Settings</button>
                        <button className="btn btn-secondary">User Management</button>
                     </div>
                 </div>
                 <div className="dashboard-card multi-dept-view">
                     <h3><Icon name="building"/> Department Live View</h3>
                      <ul className="dept-list">
                          {stats.departmentData.map(dept => (
                              <li key={dept.name}>
                                 <div className="dept-info">
                                     <strong>{dept.name}</strong>
                                     <span>{dept.classCount} Classes / Week</span>
                                 </div>
                                 <div className="dept-faculty">
                                      <Icon name="users"/> {dept.facultyCount} Faculty
                                 </div>
                              </li>
                          ))}
                      </ul>
                 </div>
            </div>
        </>
    )
}


const DashboardView = ({ entries, timeSlots, department, year, setDepartment, setYear, role, setView }: { entries: TimetableEntry[], timeSlots: string[], department: string, year: string, setDepartment: (d: string) => void, setYear: (y: string) => void, role: UserRole, setView: (v: AppView) => void }) => {

    const renderDashboardByRole = () => {
        switch (role) {
            case 'student':
                return <StudentDashboard entries={entries} timeSlots={timeSlots} department={department} year={year} setDepartment={setDepartment} setYear={setYear} />;
            case 'faculty':
                return <FacultyDashboard entries={entries} timeSlots={timeSlots} department={department} year={year} setDepartment={setDepartment} setYear={setYear} />;
            case 'hod':
                return <HODDashboard entries={entries} timeSlots={timeSlots} department={department} setDepartment={setDepartment} />;
            case 'admin':
                return <AdminDashboard entries={entries} setView={setView} />;
            default:
                return <div>Invalid Role Selected</div>;
        }
    }

    return (
        <div className="dashboard-container">
            {renderDashboardByRole()}
        </div>
    );
};

const PermissionDenied = () => (
    <div className="permission-denied">
        <h2>Permission Denied</h2>
        <p>You do not have the required privileges to access this page.</p>
    </div>
);


// --- Main App Component ---
const App = () => {
    const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light');
    const [role, setRole] = useState<UserRole>('student');
    const [view, setView] = useState<AppView>('dashboard');
    const [timetableEntries, setTimetableEntries] = useState<TimetableEntry[]>([]);
    const [timeSlots, setTimeSlots] = useState<string[]>(defaultTimeSlots);
    const [editingEntry, setEditingEntry] = useState<TimetableEntry | null>(null);
    const [editMode, setEditMode] = useState(false);
    const [selectedDepartment, setSelectedDepartment] = useState(departments[0]);
    const [selectedYear, setSelectedYear] = useState(years[1]); // Default to Year 2 for sample data
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);


    const hasPrivilege = useMemo(() => privilegedRoles.includes(role), [role]);

    const fetchAllData = useCallback(async () => {
        await initDB(sampleTimetableToFlat());
        const entries = await getAllEntries();
        const savedTimeSlots = await getSetting<string[]>('timeSlots');
        setTimetableEntries(entries);
        if (savedTimeSlots) {
            setTimeSlots(savedTimeSlots);
        } else {
            await setSetting('timeSlots', defaultTimeSlots);
        }
    }, []);

    useEffect(() => {
        fetchAllData();
    }, [fetchAllData]);

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    }, [theme]);
    
    useEffect(() => {
        // Disable edit mode if user loses privilege
        if (!hasPrivilege) {
            setEditMode(false);
        }
    }, [hasPrivilege]);
    
    // Auto-select a relevant department based on role
    useEffect(() => {
        switch(role) {
            case 'student':
            case 'faculty':
            case 'hod':
                setSelectedDepartment('CSE'); // Default for non-admin roles
                break;
            case 'admin':
                // Admin can see everything, no default change needed
                break;
        }
    }, [role]);

    const transformedData = useMemo(() => transformEntriesToNested(timetableEntries, timeSlots), [timetableEntries, timeSlots]);

    const toggleTheme = () => setTheme(theme === 'light' ? 'dark' : 'light');

    const handleUpdateEntry = async (updatedEntry: TimetableEntry) => {
        const existingEntry = timetableEntries.find(e => e.id === updatedEntry.id);
        if (existingEntry) {
            await updateEntry(updatedEntry);
        } else {
             await addEntry(updatedEntry);
        }
        await fetchAllData();
        setEditingEntry(null);
    };
    
    const handleAddDBEntry = async (newEntryData: Omit<TimetableEntry, 'id'>) => {
        const { department, year, day, timeIndex } = newEntryData;
        const id = `${department}_${year}_${day}_${timeIndex}`.replace(/\s+/g, '-');
        const entry: TimetableEntry = { id, ...newEntryData };
        await addEntry(entry);
        await fetchAllData();
    };
    
    const handleDeleteDBEntry = async (id: string) => {
        if (confirm('Are you sure you want to delete this entry?')) {
            await deleteEntry(id);
            await fetchAllData();
        }
    };
    
    const handleSetTimeSlots = async (newTimeSlots: string[]) => {
        setTimeSlots(newTimeSlots);
        await setSetting('timeSlots', newTimeSlots);
    }

    const renderView = () => {
        switch(view) {
            case 'dashboard':
                return <DashboardView entries={timetableEntries} timeSlots={timeSlots} department={selectedDepartment} year={selectedYear} setDepartment={setSelectedDepartment} setYear={setSelectedYear} role={role} setView={setView} />;
            case 'timetable':
                return <TimetableView data={transformedData} timeSlots={timeSlots} onCellClick={setEditingEntry} department={selectedDepartment} year={selectedYear} setDepartment={setSelectedDepartment} setYear={setSelectedYear} hasPrivilege={hasPrivilege} editMode={editMode} setEditMode={setEditMode} />;
            case 'manage':
                return hasPrivilege ? <ManageTimetableView entries={timetableEntries} onAdd={handleAddDBEntry} onUpdate={handleUpdateEntry} onDelete={handleDeleteDBEntry} timeSlots={timeSlots} /> : <PermissionDenied />;
            case 'settings':
                return hasPrivilege ? <SettingsView timeSlots={timeSlots} setTimeSlots={handleSetTimeSlots} /> : <PermissionDenied />;
            default:
                return <h2>Timetable</h2>;
        }
    };

    const viewTitles: Record<AppView, string> = {
        dashboard: 'Dashboard',
        timetable: 'Timetable',
        manage: 'Manage Timetable',
        settings: 'Settings'
    };
    
    interface ChatMessage {
        role: 'user' | 'model';
        parts: { text: string }[];
        isError?: boolean;
    }
    
    const Chatbot = ({ timetableEntries }: { timetableEntries: TimetableEntry[] }) => {
        const [isOpen, setIsOpen] = useState(false);
        const [chat, setChat] = useState<Chat | null>(null);
        const [messages, setMessages] = useState<ChatMessage[]>([]);
        const [userInput, setUserInput] = useState("");
        const [isLoading, setIsLoading] = useState(false);
        const [initError, setInitError] = useState<string | null>(null);
        const [isContextSent, setIsContextSent] = useState(false);
        const chatHistoryRef = useRef<HTMLDivElement>(null);
    
        useEffect(() => {
            if (!process.env.API_KEY) {
                console.error("API_KEY environment variable not set.");
                setInitError("The AI Assistant is not configured correctly. An API key is required for it to function.");
                return;
            }

            try {
                const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
                const systemInstruction = `You are an intelligent AI assistant for a college timetable application. Your name is Academia AI.
                Your role is to answer questions based ONLY on the provided timetable data. The data will be given to you in JSON format.
                - Do not invent any information. If the answer is not in the data, say "I don't have that information in the current timetable."
                - Format your answers clearly using Markdown (e.g., use lists, bold text for emphasis).
                - Be concise and friendly.
                - The current day is ${new Date().toLocaleDateString('en-US', { weekday: 'long' })}.`;
                
                const newChat = ai.chats.create({
                    model: 'gemini-2.5-flash',
                    config: { systemInstruction },
                });
                setChat(newChat);
                setInitError(null);
            } catch (error) {
                console.error("Failed to initialize GoogleGenAI:", error);
                setInitError("There was an error initializing the AI Assistant. Please check the console for details.");
            }
        }, []);

        useEffect(() => {
            if (initError) {
                // Handled in JSX
            } else if (chat && messages.length === 0) {
                 setMessages([
                    {
                        role: 'model',
                        parts: [{ text: "Hello! I'm Academia AI. How can I help you with the timetable today? You can ask me things like 'What is the schedule for CSE Year 2 on Friday?'" }]
                    }
                ]);
            }
        }, [chat, initError]);
        
        useEffect(() => {
            if (chatHistoryRef.current) {
                chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
            }
        }, [messages, initError]);
    
        const handleSendMessage = async () => {
            if (!userInput.trim() || !chat || initError) return;
    
            setIsLoading(true);
            const userMessage: ChatMessage = { role: 'user', parts: [{ text: userInput }] };
            setMessages(prev => [...prev, userMessage]);
            
            let messageToSend = userInput;
            if (!isContextSent) {
                messageToSend = `Here is the full timetable data in JSON format: ${JSON.stringify(timetableEntries)}. Now, using this data as your ONLY source of truth, answer the following question: ${userInput}`;
                setIsContextSent(true);
            }

            setUserInput("");
    
            try {
                const result = await chat.sendMessageStream({ message: messageToSend });
                
                let currentModelResponse = "";
                setMessages(prev => [...prev, { role: 'model', parts: [{ text: "" }] }]);
                
                for await (const chunk of result) {
                    currentModelResponse += chunk.text;
                    setMessages(prev => {
                        const newMessages = [...prev];
                        newMessages[newMessages.length - 1].parts[0].text = currentModelResponse;
                        return newMessages;
                    });
                }
    
            } catch (error) {
                console.error("Error sending message:", error);
                 let errorMessage = "Sorry, I encountered an unexpected error. Please try again.";
                 if (error instanceof Error) {
                    const lowerCaseMessage = error.message.toLowerCase();
                    if (lowerCaseMessage.includes('fetch') || lowerCaseMessage.includes('network')) {
                        errorMessage = "I'm having trouble connecting to the AI service. This could be a network issue or a browser security restriction (CORS) in your preview environment. Please check your network and the browser's developer console for more details.";
                    } else if (lowerCaseMessage.includes('api key')) {
                        errorMessage = "There seems to be an issue with the API key configuration. Please ensure it is set up correctly.";
                    }
                }
                setMessages(prev => {
                    const newMessages = [...prev];
                    const lastMessage = newMessages[newMessages.length - 1];
                    if (lastMessage?.role === 'model' && lastMessage.parts[0].text === "") {
                        // If there's already an empty model bubble, fill it with the error.
                        lastMessage.parts[0].text = errorMessage;
                        lastMessage.isError = true;
                    } else {
                        // Otherwise, add a new error bubble.
                        newMessages.push({ role: 'model', parts: [{ text: errorMessage }], isError: true });
                    }
                    return newMessages;
                });
            } finally {
                setIsLoading(false);
            }
        };
    
        return (
            <>
                <button className="fab" onClick={() => setIsOpen(!isOpen)} aria-label="Toggle AI Chat">
                    <Icon name={isOpen ? "cancel" : "chat"} />
                </button>
                <div className={`chat-modal ${isOpen ? 'visible' : ''}`}>
                    <div className="chat-header">
                        <Icon name="chat" /> Academia AI Assistant
                    </div>
                    <div className="chat-history" ref={chatHistoryRef}>
                        {initError && (
                             <div className="chat-message model">
                                <div className="message-bubble model error">
                                    {initError}
                                </div>
                            </div>
                        )}
                        {messages.map((msg, index) => (
                            <div key={index} className={`chat-message ${msg.role}`}>
                                <div
                                    className={`message-bubble ${msg.role} ${msg.isError ? 'error' : ''}`}
                                    dangerouslySetInnerHTML={{ __html: marked.parse(msg.parts[0].text) }}
                                />
                            </div>
                        ))}
                         {isLoading && messages[messages.length - 1]?.role === 'user' && (
                            <div className="chat-message model">
                                <div className="message-bubble model">Typing...</div>
                            </div>
                        )}
                    </div>
                    <div className="chat-input-area">
                        <textarea
                            className="chat-input"
                            placeholder={initError ? "AI Assistant is unavailable" : "Ask about the timetable..."}
                            value={userInput}
                            onChange={(e) => setUserInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSendMessage();
                                }
                            }}
                            disabled={isLoading || !!initError}
                        />
                        <button className="send-button" onClick={handleSendMessage} disabled={isLoading || !userInput.trim() || !!initError}>
                            <Icon name="send" />
                        </button>
                    </div>
                </div>
            </>
        );
    };

    return (
        <div className={`app-container ${isSidebarOpen ? 'sidebar-open' : ''}`}>
            <Sidebar currentView={view} setView={setView} hasPrivilege={hasPrivilege} isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
            {isSidebarOpen && <div className="sidebar-overlay" onClick={() => setIsSidebarOpen(false)}></div>}
            <main className="main-content">
                <Header title={viewTitles[view]} role={role} setRole={setRole} theme={theme} toggleTheme={toggleTheme} onMenuClick={() => setIsSidebarOpen(true)} />
                <div className="page-content" key={view}>
                    {renderView()}
                </div>
            </main>
            {editingEntry && (
                <EditModal
                    entry={editingEntry}
                    onSave={handleUpdateEntry}
                    onCancel={() => setEditingEntry(null)}
                    timeSlots={timeSlots}
                />
            )}
            <Chatbot timetableEntries={timetableEntries} />
        </div>
    );
};


const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);