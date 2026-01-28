import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCalDavEvent, updateCalDavEvent, CalDAVConfig } from './caldav';
import { Event } from '../types';

// Supabase Mocking
// Note: We mock the module itself.
vi.mock('../lib/supabase', () => ({
    supabase: {
        auth: {
            getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'valid-token', expires_at: Date.now() + 3600 } } }),
            refreshSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'valid-token' } } })
        }
    },
    supabaseAnonKey: 'test-anon-key'
}));

// Mock API service to avoid DB calls
vi.mock('./api', () => ({
    createEvent: vi.fn(),
    eventExists: vi.fn(),
    eventExistsByUID: vi.fn(),
    deleteRemovedEvents: vi.fn(),
    updateEventUID: vi.fn(),
    updateEventByUID: vi.fn(),
    fetchEventByUID: vi.fn(),
    findEventByDetails: vi.fn(),
    // ... add others as needed
}));

// Mock global fetch
const fetchMock = vi.fn();
global.fetch = fetchMock;

// Mock Deno env for URL (if needed, but caldav.ts uses import.meta.env which is harder to mock in node environment without setup)
// However, caldav.ts sets supabaseUrl via import.meta.env.VITE_SUPABASE_URL.
// Jest/Vitest runs in Node, so import.meta.env might be undefined.
// We need to ensure 'import.meta.env' is handled or mocked before importing caldav.ts basically.
// But since we already imported it, maybe it's too late?
// Vitest handles import.meta.env if configured, but let's try.

describe('CalDAV Service (Phase 2-4 Logic)', () => {
    const config: CalDAVConfig = {
        serverUrl: 'https://test.cal',
        username: 'user',
        password: 'pw',
        settingId: 'secure-setting-id-123'
    };

    beforeEach(() => {
        fetchMock.mockReset();
        // Setup successful fetch response
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ success: true, etag: '"new-etag"' }),
        });
    });

    it('createCalDavEvent: sends settingId and ICS data (Phase 2 + 4)', async () => {
        const event: Partial<Event> = {
            title: 'Test Meeting',
            date: '2024-05-01',
            caldavUid: 'test-uid-1'
        };

        await createCalDavEvent(config, 'https://cal.url', event);

        expect(fetchMock).toHaveBeenCalled();
        const callArgs = fetchMock.mock.calls[0];
        const url = callArgs[0] as string;
        const options = callArgs[1] as RequestInit;
        const body = JSON.parse(options.body as string);

        expect(url).toContain('caldav-proxy');
        expect(body.action).toBe('createEvent');
        expect(body.settingId).toBe('secure-setting-id-123'); // Phase 4 Security Check
        expect(body.eventData).toContain('SUMMARY:Test Meeting'); // ICS Check
    });

    it('updateCalDavEvent sends etag for concurrency control (Phase 3)', async () => {
        const event: Partial<Event> = {
            title: 'Updated Event',
            date: '2024-01-29'
        };
        const uid = 'uid-123';
        const etag = '"old-etag"';

        await updateCalDavEvent(config, 'https://cal.com/calendar', uid, event, etag);

        const callArgs = fetchMock.mock.calls[1]; // Second call (after create) or check reset
        // Actually beforeEach resets mock, so it should be calls[0] if run independently or sequentially
        
        // Vitest runs tests sequentially in same file by default? Yes.
        // fetchMock.mockReset() in beforeEach handles it.
        const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);

        expect(body.action).toBe('updateEvent');
        expect(body.eventUid).toBe(uid);
        expect(body.etag).toBe('"old-etag"'); // Phase 3 Check
    });
});
