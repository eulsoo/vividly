import { Event } from '../types';
import { serializeEventToICS } from './icsParser';

// ... (functions)

// ----------------------------------------------------------------------------
// Write Operations (Create, Update, Delete)
// ----------------------------------------------------------------------------

export async function createCalDavEvent(
  config: CalDAVConfig,
  calendarUrl: string,
  event: Partial<Event>
): Promise<{ success: boolean; etag?: string }> {
  const icsData = serializeEventToICS(event);
  // serializeEventToICS generated a UID in event.caldavUid or we should ensure we get it.
  // Actually serializeEventToICS returns string, so we need to know the UID it used.
  // Better approach: generate UID here, assign to event, them serialize.
  
  // Re-generate UID if missing to be sure
  const uid = event.caldavUid || `vividly-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const eventWithUid = { ...event, caldavUid: uid };
  const finalIcs = serializeEventToICS(eventWithUid);

  return await invokeCalDavProxy<{ success: boolean; etag?: string }>({
    serverUrl: config.serverUrl,
    username: config.username,
    password: config.password,
    action: 'createEvent',
    calendarUrl,
    eventUid: uid,
    eventData: finalIcs
  });
}

export async function updateCalDavEvent(
  config: CalDAVConfig,
  calendarUrl: string,
  uid: string,
  event: Partial<Event>,
  etag?: string
): Promise<{ success: boolean; etag?: string }> {
  const eventWithUid = { ...event, caldavUid: uid };
  const finalIcs = serializeEventToICS(eventWithUid);

  return await invokeCalDavProxy<{ success: boolean; etag?: string }>({
    serverUrl: config.serverUrl,
    username: config.username,
    password: config.password,
    action: 'updateEvent',
    calendarUrl,
    eventUid: uid,
    eventData: finalIcs,
    etag // Send ETag for optimistic concurrency control (if supported)
  });
}

export async function deleteCalDavEvent(
  config: CalDAVConfig,
  calendarUrl: string,
  uid: string,
  etag?: string
): Promise<{ success: boolean }> {
  return await invokeCalDavProxy<{ success: boolean }>({
    serverUrl: config.serverUrl,
    username: config.username,
    password: config.password,
    action: 'deleteEvent',
    calendarUrl,
    eventUid: uid,
    etag
  });
}
import { createEvent, eventExists, eventExistsByUID, deleteRemovedEvents, updateEventUID, updateEventByUID, fetchEventByUID, findEventByDetails } from './api';
import { supabase, supabaseAnonKey } from '../lib/supabase';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;

// 캘린더 URL을 일관되게 비교하기 위해 끝의 슬래시를 제거
const normalizeCalendarUrl = (url: string) => url.replace(/\/+$/, '');

// 동시 동기화 방지 플래그
let syncInFlight = false;

export interface Calendar {
  displayName: string;
  url: string;
  ctag?: string;
  color?: string;
}

export interface CalDAVConfig {
  serverUrl: string;
  username: string;
  password: string;
}

interface SyncCollectionResult {
  events: Omit<Event, 'id'>[];
  syncToken: string | null;
  hasDeletions: boolean;
}

const getSyncTokenStorageKey = (config: CalDAVConfig) =>
  `caldavSyncTokens:${config.serverUrl}:${config.username}`;

const decodeJwtPayload = (token: string): Record<string, any> | null => {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = atob(padded);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
};

const getFunctionHeaders = async (): Promise<Record<string, string> | null> => {
  try {
    const { data } = await supabase.auth.getSession();
    let token = data?.session?.access_token || null;
    const expiresAt = data?.session?.expires_at ? data.session.expires_at * 1000 : null;

    // 만료/임박이면 refresh 시도
    const needsRefresh = !token || (expiresAt && Date.now() > expiresAt - 60 * 1000);
    if (needsRefresh) {
      const refreshed = await supabase.auth.refreshSession();
      token = refreshed.data?.session?.access_token || null;
    }

    // refresh 실패 또는 만료된 토큰이면 호출하지 않음
    if (!token) {
      console.warn('CalDAV 동기화: 유효한 세션 토큰이 없어 요청을 건너뜁니다.');
      return null;
    }

    const payload = decodeJwtPayload(token);
    const tokenExp = payload?.exp ? payload.exp * 1000 : null;
    if (tokenExp && Date.now() > tokenExp - 30 * 1000) {
      console.warn('CalDAV 동기화: 만료된 세션 토큰입니다.');
      return null;
    }

    if (payload?.iss && supabaseUrl && !payload.iss.startsWith(`${supabaseUrl}/auth/v1`)) {
      console.error('CalDAV 동기화: Supabase 프로젝트가 일치하지 않습니다.', {
        expected: `${supabaseUrl}/auth/v1`,
        actual: payload.iss,
      });
      return null;
    }

    return {
      Authorization: `Bearer ${token}`,
      apikey: supabaseAnonKey || '',
    };
  } catch (error) {
    console.error('세션 토큰 가져오기/갱신 실패:', error);
  }
  console.warn('CalDAV 동기화: 세션 토큰이 없어 요청을 건너뜁니다.');
  return null;
};

const invokeCalDavProxy = async <T>(
  body: Record<string, any>,
  retryOnUnauthorized: boolean = true
): Promise<T> => {
  if (!supabaseUrl) {
    throw new Error('Supabase URL이 설정되지 않아 CalDAV 요청을 실행할 수 없습니다.');
  }

  let headers = await getFunctionHeaders();
  if (!headers) {
    throw new Error('인증 토큰이 없어 CalDAV 요청을 실행할 수 없습니다.');
  }

  const doFetch = async () => {
    const response = await fetch(`${supabaseUrl}/functions/v1/caldav-proxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: headers!.Authorization,
        apikey: headers!.apikey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('CalDAV proxy error', {
        status: response.status,
        body: errorText,
      });
      const error = new Error(`Edge Function returned ${response.status}`);
      (error as any).status = response.status;
      (error as any).body = errorText;
      throw error;
    }

    return (await response.json()) as T;
  };

  try {
    return await doFetch();
  } catch (error: any) {
    if (retryOnUnauthorized && error?.status === 401) {
      await supabase.auth.refreshSession();
      headers = await getFunctionHeaders();
      if (headers) {
        return await doFetch();
      }
    }
    throw error;
  }
};

const readSyncTokens = (config: CalDAVConfig): Record<string, string> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(getSyncTokenStorageKey(config));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const writeSyncTokens = (config: CalDAVConfig, tokens: Record<string, string>) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(getSyncTokenStorageKey(config), JSON.stringify(tokens));
};

// 사용 가능한 캘린더 목록 가져오기 (Edge Function 사용)
export async function getCalendars(config: CalDAVConfig): Promise<Calendar[]> {
  try {
    const response = await invokeCalDavProxy<Calendar[]>({
      serverUrl: config.serverUrl,
      username: config.username,
      password: config.password,
      action: 'listCalendars',
    });

    // 오류가 있으면 처리
    if ((response as any)?.error) {
      console.error('Edge Function 오류:', (response as any).error);
      
      // 오류 응답 본문 파싱 시도
      let errorMessage = '캘린더 목록을 가져올 수 없습니다.';
      
      try {
        // response.error가 객체인 경우
        const errorContext = (response as any).error?.context;
        if (errorContext?.body) {
          const errorBody = typeof errorContext.body === 'string' 
            ? JSON.parse(errorContext.body) 
            : errorContext.body;
          if (errorBody.error) {
            errorMessage = errorBody.error;
            if (errorBody.details) {
              errorMessage += `\n상세: ${errorBody.details}`;
            }
          }
        } else if ((response as any).error?.message) {
          errorMessage = (response as any).error.message;
        }
      } catch (parseError) {
        console.error('오류 파싱 실패:', parseError);
      }
      
      throw new Error(errorMessage);
    }

    const data = response;

    if (!data || !Array.isArray(data)) {
      // data가 오류 객체일 수 있음
      if (data && typeof data === 'object' && 'error' in data) {
        throw new Error(data.error || '캘린더 목록을 가져올 수 없습니다.');
      }
      throw new Error('캘린더 목록을 가져올 수 없습니다.');
    }

    if (data.length === 0) {
      throw new Error('캘린더를 찾을 수 없습니다. iCloud에서 캘린더가 활성화되어 있는지 확인해주세요.');
    }

    return data as Calendar[];
  } catch (error: any) {
    console.error('캘린더 목록 가져오기 실패:', error);
    console.error('오류 상세:', JSON.stringify(error, null, 2));
    
    let errorMessage = '캘린더 목록을 가져올 수 없습니다.';
    
    if (error?.message) {
      errorMessage = error.message;
    }
    
    throw new Error(errorMessage);
  }
}

// 특정 캘린더의 이벤트 가져오기 (Edge Function 사용)
export async function fetchCalendarEvents(
  config: CalDAVConfig,
  calendarUrl: string,
  startDate?: Date,
  endDate?: Date
): Promise<Omit<Event, 'id'>[]> {
  try {
    const startDateStr = startDate ? startDate.toISOString().split('T')[0] : undefined;
    const endDateStr = endDate ? endDate.toISOString().split('T')[0] : undefined;
    const data = await invokeCalDavProxy<Omit<Event, 'id'>[]>({
      serverUrl: config.serverUrl,
      username: config.username,
      password: config.password,
      action: 'fetchEvents',
      calendarUrl,
      startDate: startDateStr,
      endDate: endDateStr,
    });

    if (!data || !Array.isArray(data)) {
      throw new Error('이벤트를 가져올 수 없습니다.');
    }

    return data as Omit<Event, 'id'>[];
  } catch (error: any) {
    console.error('이벤트 가져오기 실패:', error);
    
    let errorMessage = '이벤트를 가져올 수 없습니다.';
    
    if (error?.message) {
      errorMessage = error.message;
    }
    
    if (error?.error) {
      errorMessage = error.error;
    }
    
    throw new Error(errorMessage);
  }
}

export async function fetchSyncToken(
  config: CalDAVConfig,
  calendarUrl: string
): Promise<string | null> {
  try {
    const data = await invokeCalDavProxy<{ syncToken: string | null }>({
      serverUrl: config.serverUrl,
      username: config.username,
      password: config.password,
      action: 'getSyncToken',
      calendarUrl,
    });

    return data?.syncToken || null;
  } catch (error: any) {
    console.error('sync-token 가져오기 실패:', error);
    return null;
  }
}

export async function fetchSyncCollection(
  config: CalDAVConfig,
  calendarUrl: string,
  syncToken: string
): Promise<SyncCollectionResult> {
  const data = await invokeCalDavProxy<{
    events?: Omit<Event, 'id'>[];
    syncToken?: string | null;
    hasDeletions?: boolean;
  }>({
    serverUrl: config.serverUrl,
    username: config.username,
    password: config.password,
    action: 'syncCollection',
    calendarUrl,
    syncToken,
  });

  return {
    events: data?.events || [],
    syncToken: data?.syncToken || null,
    hasDeletions: Boolean(data?.hasDeletions),
  };
}

// 선택한 여러 캘린더의 이벤트 동기화
export async function syncSelectedCalendars(
  config: CalDAVConfig,
  selectedCalendarUrls: string[],
  lastSyncAt?: string | null  // 마지막 동기화 시간 추가
): Promise<number> {
  // 동기화 중복 실행 방지
  if (syncInFlight) {
    return 0;
  }
  syncInFlight = true;

  try {
    let syncedCount = 0;
    let skippedCount = 0;
    let deletedCount = 0;
    const syncTokens = readSyncTokens(config);

    if (lastSyncAt) {
      console.log(`마지막 동기화 시점(${lastSyncAt})부터 동기화합니다.`);
    } else {
      console.log('첫 동기화: 최근 1년간의 일정을 가져옵니다.');
    }
    
    for (const rawCalendarUrl of selectedCalendarUrls) {
      const calendarUrl = normalizeCalendarUrl(rawCalendarUrl);
      try {
        const currentEventUids = new Set<string>();
        let calendarSyncedCount = 0;
        let calendarSkippedCount = 0;
        let usedFullFetch = false;

        const token = syncTokens[calendarUrl];
        let syncResult: SyncCollectionResult | null = null;

        if (token) {
          try {
            syncResult = await fetchSyncCollection(config, calendarUrl, token);
          } catch (error: any) {
            console.warn(`sync-collection 실패, 전체 동기화로 전환: ${calendarUrl}`, error);
            syncResult = null;
          }
        }

        if (syncResult && syncResult.hasDeletions) {
          syncResult = null;
        }

        let eventsToProcess: Omit<Event, 'id'>[] = [];
        if (syncResult) {
          eventsToProcess = syncResult.events;
        } else {
          usedFullFetch = true;
          const fullStartDate = new Date();
          fullStartDate.setFullYear(fullStartDate.getFullYear() - 1); // 1년 전부터
          const fullEndDate = new Date();
          fullEndDate.setFullYear(fullEndDate.getFullYear() + 1); // 1년 후까지
          eventsToProcess = await fetchCalendarEvents(config, calendarUrl, fullStartDate, fullEndDate);
        }

        // CalDAV에서 가져온 이벤트 처리
        for (const event of eventsToProcess) {
          // UID가 있는 경우 UID로 중복 체크, 없으면 기존 방식 사용
          const eventWithUID = event as any;
          const uid = eventWithUID.uid;
          
          if (uid) {
            currentEventUids.add(uid);
            // UID로 중복 체크 (가장 확실한 방법)
            const exists = await eventExistsByUID(uid, calendarUrl);
            if (exists) {
              // 기존 이벤트가 있으면 변경된 필드만 업데이트
              const existing = await fetchEventByUID(uid, calendarUrl);
              if (existing) {
                const normalizeTime = (value?: string | null) => value ?? null;
                const updates: {
                  title?: string;
                  date?: string;
                  memo?: string | null;
                  startTime?: string | null;
                  endTime?: string | null;
                  color?: string;
                } = {};

                if (existing.title !== event.title) updates.title = event.title;
                if (existing.date !== event.date) updates.date = event.date;
                if ((existing.memo ?? null) !== (event.memo ?? null)) updates.memo = event.memo ?? null;
                if (normalizeTime(existing.startTime) !== normalizeTime(event.startTime)) {
                  updates.startTime = event.startTime ?? null;
                }
                if (normalizeTime(existing.endTime) !== normalizeTime(event.endTime)) {
                  updates.endTime = event.endTime ?? null;
                }
                if (existing.color !== event.color) updates.color = event.color;

                const hasUpdates = Object.keys(updates).length > 0;
                if (hasUpdates) {
                  const updated = await updateEventByUID(uid, calendarUrl, updates);
                  if (updated) {
                    calendarSyncedCount++;
                  } else {
                    calendarSkippedCount++;
                  }
                } else {
                  calendarSkippedCount++;
                }
              } else {
                calendarSkippedCount++;
              }
              continue; // 이미 존재하므로 다음 이벤트로
            }
            
            // UID가 없는 기존 이벤트가 있는지 확인 (제목+날짜+시간으로)
            // 이 경우에만 기존 이벤트에 UID를 업데이트
            const existingEventId = await findEventByDetails(event, calendarUrl);
            if (existingEventId) {
              // 기존 이벤트에 UID 업데이트
              await updateEventUID(existingEventId, uid, calendarUrl);
              calendarSkippedCount++;
              continue; // 업데이트했으므로 다음 이벤트로
            }
            
            // 새 이벤트 생성
            // event에서 uid 필드 제거 (caldavUid로 전달)
            const { uid: _uid, ...eventWithoutUid } = event as any;
            const result = await createEvent({
              ...eventWithoutUid,
              caldavUid: uid,
              calendarUrl,
              source: 'caldav',
            });
            if (result) {
              calendarSyncedCount++;
            }
          } else {
            // UID가 없는 경우 기존 방식으로 중복 체크
          const exists = await eventExists(event, calendarUrl, 'caldav');
            if (!exists) {
              const result = await createEvent({
                ...event,
                calendarUrl,
                source: 'caldav',
              });
              if (result) {
                calendarSyncedCount++;
              }
            } else {
              calendarSkippedCount++;
            }
          }
        }
        
        syncedCount += calendarSyncedCount;
        skippedCount += calendarSkippedCount;
        
        if (calendarSyncedCount > 0 || calendarSkippedCount > 0) {
          console.log(`캘린더 ${calendarUrl}: ${calendarSyncedCount}개 추가, ${calendarSkippedCount}개 스킵`);
        }
        
        // 해당 캘린더에서 삭제된 이벤트 찾기 및 삭제
        // allEvents가 빈 배열이어도 삭제 체크 수행 (캘린더에서 모든 이벤트를 삭제한 경우 처리)
        if (usedFullFetch) {
          const deleted = await deleteRemovedEvents(calendarUrl, currentEventUids, eventsToProcess);
          deletedCount += deleted;
          if (deleted > 0) {
            console.log(`캘린더 ${calendarUrl}: ${deleted}개 삭제`);
          } else if (eventsToProcess.length === 0) {
            console.log(`캘린더 ${calendarUrl}: 이벤트 없음 (삭제 체크 완료)`);
          }
        }

        if (syncResult?.syncToken) {
          syncTokens[calendarUrl] = syncResult.syncToken;
        } else if (usedFullFetch) {
          const nextToken = await fetchSyncToken(config, calendarUrl);
          if (nextToken) {
            syncTokens[calendarUrl] = nextToken;
          }
        }
      } catch (error) {
        console.error(`캘린더 ${calendarUrl} 동기화 실패:`, error);
      }
    }
    
    writeSyncTokens(config, syncTokens);
    console.log(`동기화 완료: ${syncedCount}개 추가, ${deletedCount}개 삭제, ${skippedCount}개 스킵`);
    
    // 삭제된 이벤트가 있으면 -1을 반환하여 UI 갱신을 트리거
    if (deletedCount > 0) {
      return -1; // 삭제가 있었음을 나타냄
    }
    
    return syncedCount;
  } finally {
    syncInFlight = false;
  }
}

