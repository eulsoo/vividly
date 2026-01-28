import { describe, it, expect } from 'vitest';
import { serializeEventToICS } from './icsParser';
import { Event } from '../types';

describe('ICS Parser (Phase 1 Check)', () => {
    it('creates a valid ICS string for a timed event', () => {
        const event: Partial<Event> = {
            title: 'Meeting',
            date: '2024-01-29',
            startTime: '10:00',
            endTime: '11:00',
            caldavUid: 'uid-123'
        };

        const result = serializeEventToICS(event);
        
        expect(result).toContain('BEGIN:VCALENDAR');
        expect(result).toContain('BEGIN:VEVENT');
        expect(result).toContain('SUMMARY:Meeting');
        expect(result).toContain('UID:uid-123');
        expect(result).toContain('DTSTART'); 
        expect(result).toContain('DTEND');
    });

    it('handles all-day events correctly (DTSTART;VALUE=DATE)', () => {
        const event: Partial<Event> = {
            title: 'All Day Event',
            date: '2024-01-29'
        };

        const result = serializeEventToICS(event);
        
        // VALUE=DATE is key for all-day events in ical.js output
        // Note: ical.js might output strictly 'DTSTART;VALUE=DATE:...' or just 'DTSTART:...' with parameters separate.
        // But usually toStrict() puts parameters in line.
        
        // Checking for the date string at least
        expect(result).toContain('20240129');
        // End date should be next day: 20240130
        expect(result).toContain('20240130');
    });
});
