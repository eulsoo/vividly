// Supabase Edge Function: CalDAV Proxy
// CORS 문제를 해결하기 위한 백엔드 프록시

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
declare const Deno: any;

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

// Base64 인코딩 헬퍼 함수
function base64Encode(str: string): string {
  return btoa(unescape(encodeURIComponent(str)));
}

interface CalDAVRequest {
  serverUrl: string;
  username: string;
  password: string;
  action: 'listCalendars' | 'fetchEvents' | 'getSyncToken' | 'syncCollection' | 'createEvent' | 'updateEvent' | 'deleteEvent';
  calendarUrl?: string;
  startDate?: string;
  endDate?: string;
  syncToken?: string;
  eventData?: string; // ICS content for PUT
  eventUid?: string;  // Resource filename (e.g. uid.ics) for PUT/DELETE
  etag?: string;      // For If-Match
}

interface Calendar {
  displayName: string;
  url: string;
  ctag?: string;
}

interface Event {
  date: string;
  title: string;
  memo?: string;
  startTime?: string;
  endTime?: string;
  color: string;
  uid?: string;  // CalDAV UID 추가
}

Deno.serve(async (req) => {
  // CORS 헤더 설정
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  // OPTIONS 요청 처리 (CORS preflight)
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // verify_jwt: false 상태에서 수동으로 JWT 검증
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: '인증 헤더가 없습니다.' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  if (!supabaseUrl || !supabaseAnonKey) {
    return new Response(
      JSON.stringify({ error: '서버 설정 오류(SUPABASE_URL/ANON_KEY).' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  const token = authHeader.slice('Bearer '.length);
  try {
    const authRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
      },
    });
    if (!authRes.ok) {
      const authBody = await authRes.text();
      return new Response(
        JSON.stringify({ error: '인증 토큰이 유효하지 않습니다.', details: authBody }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: `인증 확인 실패: ${error?.message || 'unknown error'}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    console.log('요청 받음:', req.method);
    const requestData: CalDAVRequest = await req.json();
    console.log('요청 데이터:', { 
      serverUrl: requestData.serverUrl, 
      username: requestData.username ? '***' : undefined,
      action: requestData.action 
    });

    const { serverUrl, username, password, action, calendarUrl, startDate, endDate } = requestData;

    if (!serverUrl || !username || !password || !action) {
      console.error('필수 파라미터 누락:', { serverUrl: !!serverUrl, username: !!username, password: !!password, action: !!action });
      return new Response(
        JSON.stringify({ error: '필수 파라미터가 누락되었습니다.' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    let result;

    try {
      if (action === 'listCalendars') {
        console.log('캘린더 목록 가져오기 시작');
        result = await fetchCalendars(serverUrl, username, password);
        console.log('캘린더 목록 가져오기 완료:', result.length);
      } else if (action === 'fetchEvents') {
        if (!calendarUrl) {
          return new Response(
            JSON.stringify({ error: 'calendarUrl이 필요합니다.' }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }
        console.log('이벤트 가져오기 시작');
        result = await fetchCalendarEvents(serverUrl, username, password, calendarUrl, startDate, endDate);
        console.log('이벤트 가져오기 완료:', result.length);
      } else if (action === 'getSyncToken') {
        if (!calendarUrl) {
          return new Response(
            JSON.stringify({ error: 'calendarUrl이 필요합니다.' }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }
        console.log('sync-token 가져오기 시작');
        result = await fetchSyncToken(serverUrl, username, password, calendarUrl);
        console.log('sync-token 가져오기 완료');
      } else if (action === 'syncCollection') {
        if (!calendarUrl) {
          return new Response(
            JSON.stringify({ error: 'calendarUrl이 필요합니다.' }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }
        if (!requestData.syncToken) {
          return new Response(
            JSON.stringify({ error: 'syncToken이 필요합니다.' }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }
        console.log('sync-collection 시작');
        result = await fetchSyncCollection(serverUrl, username, password, calendarUrl, requestData.syncToken);
        console.log('sync-collection 완료');
      } else if (action === 'createEvent' || action === 'updateEvent') {
        if (!calendarUrl || !requestData.eventData || !requestData.eventUid) {
          return new Response(
            JSON.stringify({ error: 'calendarUrl, eventData, eventUid가 필요합니다.' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        console.log(`${action} 시작:`, requestData.eventUid);
        result = await putEvent(serverUrl, username, password, calendarUrl, requestData.eventUid, requestData.eventData, requestData.etag);
        console.log(`${action} 완료`);
      } else if (action === 'deleteEvent') {
        if (!calendarUrl || !requestData.eventUid) {
           return new Response(
            JSON.stringify({ error: 'calendarUrl, eventUid가 필요합니다.' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        console.log('deleteEvent 시작:', requestData.eventUid);
        result = await deleteEvent(serverUrl, username, password, calendarUrl, requestData.eventUid, requestData.etag); 
        console.log('deleteEvent 완료');
      } else {
        return new Response(
          JSON.stringify({ error: '지원하지 않는 액션입니다.' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    } catch (fetchError: any) {
    console.error('fetchCalendars/fetchCalendarEvents 오류:', fetchError);
      throw fetchError;
    }

    return new Response(
      JSON.stringify(result),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('CalDAV 프록시 오류:', error);
    console.error('오류 스택:', error.stack);
    console.error('오류 타입:', typeof error);
    console.error('오류 메시지:', error.message);
    
    const errorResponse = {
      error: error.message || 'CalDAV 요청 처리 중 오류가 발생했습니다.',
      details: error.toString(),
      ...(error.stack && { stack: error.stack })
    };
    
    return new Response(
      JSON.stringify(errorResponse),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

// 캘린더 목록 가져오기 (PROPFIND 요청)
async function fetchCalendars(serverUrl: string, username: string, password: string): Promise<Calendar[]> {
  console.log('fetchCalendars 시작:', serverUrl);
  
  // iCloud CalDAV의 경우 특별한 경로 사용
  // 사용자명에서 도메인 추출 (예: user@icloud.com -> user)
  const userPart = username.split('@')[0];
  const caldavPath = `/calendars/${userPart}/`;
  const fullUrl = serverUrl.endsWith('/') 
    ? `${serverUrl}${caldavPath.slice(1)}` 
    : `${serverUrl}${caldavPath}`;

  console.log('iCloud CalDAV 경로:', fullUrl);

  // 더 간단한 PROPFIND 요청 (iCloud가 요구하는 형식) - 색상 정보 추가
  const propfindBody = `<?xml version="1.0" encoding="UTF-8"?>
<propfind xmlns="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav" xmlns:apple="http://apple.com/ns/ical/">
  <prop>
    <displayname/>
    <resourcetype/>
    <apple:calendar-color/>
    <cal:calendar-color/>
  </prop>
</propfind>`;

  try {
    console.log('PROPFIND 요청 시작:', fullUrl);
    const response = await fetch(fullUrl, {
      method: 'PROPFIND',
      headers: {
        'Content-Type': 'application/xml',
        'Depth': '1',
        'Authorization': `Basic ${base64Encode(`${username}:${password}`)}`,
        'User-Agent': 'Vividly/1.0',
      },
      body: propfindBody,
    });

    console.log('응답 상태:', response.status, response.statusText);
    console.log('응답 헤더:', Object.fromEntries(response.headers.entries()));

    if (!response.ok && response.status !== 207) {
      // 207 Multi-Status는 정상 응답
      const errorText = await response.text();
      console.error('오류 응답 본문:', errorText.substring(0, 500));
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const xmlText = await response.text();
    console.log('XML 응답 길이:', xmlText.length);
    console.log('XML 응답 시작 부분:', xmlText.substring(0, 500));
    
    const calendars = parseCalendarsFromXML(xmlText, serverUrl);
    console.log('파싱된 캘린더 수:', calendars.length);
    
    if (calendars.length === 0) {
      // .well-known 경로로 재시도
      return await tryWellKnownPath(serverUrl, username, password);
    }
    
    return calendars;
  } catch (error: any) {
    console.error('PROPFIND 요청 실패:', error);
    // .well-known 경로로 재시도
    return await tryWellKnownPath(serverUrl, username, password);
  }
}

// .well-known 경로로 시도하는 헬퍼 함수
async function tryWellKnownPath(serverUrl: string, username: string, password: string): Promise<Calendar[]> {
  const wellKnownUrl = serverUrl.endsWith('/') 
    ? `${serverUrl}.well-known/caldav` 
    : `${serverUrl}/.well-known/caldav`;

  console.log('.well-known 경로 시도:', wellKnownUrl);

  // 먼저 principal URL을 가져옴
  const propfindBody = `<?xml version="1.0" encoding="UTF-8"?>
<propfind xmlns="DAV:">
  <prop>
    <current-user-principal/>
  </prop>
</propfind>`;

  try {
    const response = await fetch(wellKnownUrl, {
      method: 'PROPFIND',
      headers: {
        'Content-Type': 'application/xml',
        'Depth': '0',
        'Authorization': `Basic ${base64Encode(`${username}:${password}`)}`,
        'User-Agent': 'Vividly/1.0',
      },
      body: propfindBody,
    });

    console.log('.well-known 응답 상태:', response.status);

    if (!response.ok && response.status !== 207) {
      const errorText = await response.text();
      console.error('.well-known 오류:', errorText.substring(0, 500));
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const xmlText = await response.text();
    console.log('.well-known XML 응답:', xmlText.substring(0, 1000));
    
    // principal URL 추출
    const principalMatch = xmlText.match(/<current-user-principal[^>]*>[\s\S]*?<href>([^<]+)<\/href>/i) ||
                            xmlText.match(/href[^>]*>([^<]+principal[^<]+)</i);
    
    if (!principalMatch) {
      console.error('Principal URL을 찾을 수 없음');
      throw new Error('Principal URL을 찾을 수 없습니다.');
    }
    
    const principalPath = principalMatch[1];
    const principalUrl = principalPath.startsWith('http') 
      ? principalPath 
      : `${serverUrl}${principalPath.startsWith('/') ? principalPath : '/' + principalPath}`;
    
    console.log('Principal URL:', principalUrl);
    
    // Principal URL에서 캘린더 홈 찾기
    const calendarHomeBody = `<?xml version="1.0" encoding="UTF-8"?>
<propfind xmlns="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <prop>
    <cal:calendar-home-set/>
  </prop>
</propfind>`;
    
    const principalResponse = await fetch(principalUrl, {
      method: 'PROPFIND',
      headers: {
        'Content-Type': 'application/xml',
        'Depth': '0',
        'Authorization': `Basic ${base64Encode(`${username}:${password}`)}`,
        'User-Agent': 'Vividly/1.0',
      },
      body: calendarHomeBody,
    });
    
    console.log('Principal 응답 상태:', principalResponse.status);
    
    if (!principalResponse.ok && principalResponse.status !== 207) {
      throw new Error(`Principal 요청 실패: ${principalResponse.status}`);
    }
    
    const principalXml = await principalResponse.text();
    console.log('Principal XML:', principalXml.substring(0, 1000));
    
    // calendar-home-set URL 추출
    const calendarHomeMatch = principalXml.match(/<calendar-home-set[^>]*>[\s\S]*?<href>([^<]+)<\/href>/i) ||
                               principalXml.match(/calendar-home-set[^>]*>[\s\S]*?href[^>]*>([^<]+)</i);
    
    if (!calendarHomeMatch) {
      // calendar-home-set이 없으면 principal URL에서 직접 캘린더 찾기
      return await fetchCalendarsFromPath(principalUrl, serverUrl, username, password);
    }
    
    const calendarHomePath = calendarHomeMatch[1];
    const calendarHomeUrl = calendarHomePath.startsWith('http')
      ? calendarHomePath
      : `${serverUrl}${calendarHomePath.startsWith('/') ? calendarHomePath : '/' + calendarHomePath}`;
    
    console.log('Calendar Home URL:', calendarHomeUrl);
    
    // Calendar Home에서 캘린더 목록 가져오기
    return await fetchCalendarsFromPath(calendarHomeUrl, serverUrl, username, password);
    
  } catch (error: any) {
    console.error('.well-known 경로도 실패:', error);
    throw new Error(`캘린더 목록을 가져올 수 없습니다: ${error.message}`);
  }
}

// 특정 경로에서 캘린더 목록 가져오기
async function fetchCalendarsFromPath(pathUrl: string, baseUrl: string, username: string, password: string): Promise<Calendar[]> {
  const propfindBody = `<?xml version="1.0" encoding="UTF-8"?>
<propfind xmlns="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav" xmlns:apple="http://apple.com/ns/ical/">
  <prop>
    <displayname/>
    <resourcetype/>
    <apple:calendar-color/>
    <cal:calendar-color/>
  </prop>
</propfind>`;

  console.log('캘린더 경로에서 PROPFIND:', pathUrl);
  
  const response = await fetch(pathUrl, {
    method: 'PROPFIND',
    headers: {
      'Content-Type': 'application/xml',
      'Depth': '1',
      'Authorization': `Basic ${base64Encode(`${username}:${password}`)}`,
      'User-Agent': 'ES-Calendar/1.0',
    },
    body: propfindBody,
  });

  console.log('캘린더 경로 응답 상태:', response.status);

  if (!response.ok && response.status !== 207) {
    const errorText = await response.text();
    console.error('캘린더 경로 오류:', errorText.substring(0, 500));
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const xmlText = await response.text();
  console.log('캘린더 경로 XML 길이:', xmlText.length);
  console.log('캘린더 경로 XML 시작:', xmlText.substring(0, 2000));
  
  const calendars = parseCalendarsFromXML(xmlText, baseUrl);
  
  if (calendars.length === 0) {
    throw new Error('캘린더를 찾을 수 없습니다. iCloud에서 캘린더가 활성화되어 있는지 확인해주세요.');
  }
  
  return calendars;
}

// XML에서 캘린더 목록 파싱
function parseCalendarsFromXML(xmlText: string, baseUrl: string): Calendar[] {
  const calendars: Calendar[] = [];
  
  console.log('XML 파싱 시작, 텍스트 길이:', xmlText.length);
  
  // 여러 네임스페이스 형식 지원
  // <d:response>, <response>, <D:response> 등
  const responseRegex = /<(?:d:)?response[^>]*>([\s\S]*?)<\/(?:d:)?response>/gi;
  let match;

  while ((match = responseRegex.exec(xmlText)) !== null) {
    const responseXml = match[1];
    
    // href 추출 (여러 형식 지원)
    const hrefMatch = responseXml.match(/<(?:d:)?href[^>]*>([^<]+)<\/(?:d:)?href>/i);
    if (!hrefMatch) {
      // 다른 형식 시도
      const hrefMatch2 = responseXml.match(/href[^>]*>([^<]+)</i);
      if (!hrefMatch2) continue;
      var href = hrefMatch2[1];
    } else {
      var href = hrefMatch[1];
    }
    
    // displayname 추출 (여러 형식 지원)
    const displayNameMatch = responseXml.match(/<(?:d:)?displayname[^>]*>([^<]+)<\/(?:d:)?displayname>/i);
    let displayName = 'Unknown';
    
    if (displayNameMatch && displayNameMatch[1]) {
      displayName = displayNameMatch[1];
    } else {
      // fallback: href의 마지막 부분을 이름으로 사용
      // 끝에 있는 슬래시 제거 후 마지막 부분 추출
      const cleanHref = href.replace(/\/+$/, '');
      const parts = cleanHref.split('/');
      if (parts.length > 0) {
        displayName = parts[parts.length - 1].replace(/%20/g, ' ').replace(/%2F/g, '/');
      }
    }
    
    // calendar 리소스 타입인지 확인
    // <cal:calendar>, <calendar>, <C:calendar> 등
    const isCalendar = /<(?:cal:)?calendar[^>]*>/i.test(responseXml) || 
                       /resourcetype[^>]*>[\s\S]*?<(?:cal:)?calendar/i.test(responseXml) ||
                       href.includes('calendar');
    
    if (isCalendar || href.match(/calendar/i)) {
      // URL 정규화
      let fullUrl: string;
      if (href.startsWith('http')) {
        fullUrl = href;
      } else if (href.startsWith('/')) {
        fullUrl = `${baseUrl}${href}`;
      } else {
        fullUrl = `${baseUrl}/${href}`;
      }
      
      
      // 색상 추출
      const color = parseColorFromXml(responseXml);
      
      calendars.push({
        displayName: decodeURIComponent(displayName),
        url: fullUrl,
        color: color || undefined,
      });
      
      console.log('캘린더 발견:', displayName, fullUrl, color);
    }
  }

  console.log('총 파싱된 캘린더:', calendars.length);
  return calendars;
}

// 색상 파싱 헬퍼
function parseColorFromXml(xmlText: string): string | null {
  const appleColorMatch = xmlText.match(/<(?:[a-zA-Z0-9]+:)?calendar-color[^>]*>([^<]+)<\//i) ||
                          xmlText.match(/calendar-color[^>]*>([^<]+)</i);
  
  if (appleColorMatch) {
    return appleColorMatch[1].trim();
  }
  return null;
}

// 캘린더 색상 조회 (PROPFIND)
async function fetchCalendarColor(
  serverUrl: string,
  username: string,
  password: string,
  calendarUrl: string
): Promise<string | null> {
  const propfindBody = `<?xml version="1.0" encoding="UTF-8"?>
<propfind xmlns="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:apple="http://apple.com/ns/ical/">
  <prop>
    <apple:calendar-color/>
    <c:calendar-color/>
  </prop>
</propfind>`;

  try {
    const response = await fetch(calendarUrl, {
      method: 'PROPFIND',
      headers: {
        'Content-Type': 'application/xml',
        'Depth': '0',
        'Authorization': `Basic ${base64Encode(`${username}:${password}`)}`,
        'User-Agent': 'Vividly/1.0',
      },
      body: propfindBody,
    });

    if (!response.ok) return null;
    const xmlText = await response.text();
    return parseColorFromXml(xmlText);
  } catch (error) {
    console.error('색상 조회 실패:', error);
    return null;
  }
}

// 캘린더 이벤트 가져오기 (REPORT 요청)
async function fetchCalendarEvents(
  serverUrl: string,
  username: string,
  password: string,
  calendarUrl: string,
  startDate?: string,
  endDate?: string
): Promise<Omit<Event, 'id'>[]> {
  console.log('fetchCalendarEvents 시작:', calendarUrl);
  
  // 1. 캘린더 색상 먼저 조회
  const calendarColor = await fetchCalendarColor(serverUrl, username, password, calendarUrl);
  console.log('캘린더 색상:', calendarColor);

  // 날짜 범위 설정 (기본값: 최근 1년 전부터 1년 후까지)
  const start = startDate || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const end = endDate || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  console.log('날짜 범위:', start, '~', end);

  // CALDAV REPORT 요청 본문
  const reportBody = `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${start}T00:00:00Z" end="${end}T23:59:59Z"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

  try {
    console.log('REPORT 요청 시작:', calendarUrl);
    const response = await fetch(calendarUrl, {
      method: 'REPORT',
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Depth': '1',
        'Authorization': `Basic ${base64Encode(`${username}:${password}`)}`,
        'User-Agent': 'Vividly/1.0',
      },
      body: reportBody,
    });

    console.log('REPORT 응답 상태:', response.status, response.statusText);

    if (!response.ok && response.status !== 207) {
      const errorText = await response.text();
      console.error('REPORT 오류 응답:', errorText.substring(0, 500));
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const xmlText = await response.text();
    // 캘린더 색상을 기본값으로 전달
    const events = parseEventsFromXML(xmlText, calendarColor || '#3b82f6');
    console.log('파싱된 이벤트 수:', events.length);
    
    return events;
  } catch (error: any) {
    console.error('fetchCalendarEvents 오류:', error);
    throw new Error(`이벤트를 가져올 수 없습니다: ${error.message}`);
  }
}

// sync-token 가져오기 (PROPFIND)
async function fetchSyncToken(
  serverUrl: string,
  username: string,
  password: string,
  calendarUrl: string
): Promise<{ syncToken: string | null }> {
  try {
    const propfindBody = `<?xml version="1.0" encoding="UTF-8"?>
<propfind xmlns="DAV:">
  <prop>
    <sync-token/>
  </prop>
</propfind>`;

    const response = await fetch(calendarUrl, {
      method: 'PROPFIND',
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Depth': '0',
        'Authorization': `Basic ${base64Encode(`${username}:${password}`)}`,
        'User-Agent': 'Vividly/1.0',
      },
      body: propfindBody,
    });

    if (!response.ok && response.status !== 207) {
      const errorText = await response.text();
      console.error('PROPFIND(sync-token) 오류 응답:', errorText.substring(0, 500));
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const xmlText = await response.text();
    const tokenMatch = xmlText.match(/<sync-token[^>]*>([\s\S]*?)<\/sync-token>/i);
    const syncToken = tokenMatch ? tokenMatch[1].trim() : null;
    return { syncToken };
  } catch (error: any) {
    console.error('fetchSyncToken 오류:', error);
    return { syncToken: null };
  }
}

// sync-collection REPORT (변경분만 가져오기)
async function fetchSyncCollection(
  serverUrl: string,
  username: string,
  password: string,
  calendarUrl: string,
  syncToken: string
): Promise<{ events: Omit<Event, 'id'>[]; syncToken: string | null; hasDeletions: boolean }> {
  // 1. 캘린더 색상 조회 (캐싱 없으므로 매번 조회)
  const calendarColor = await fetchCalendarColor(serverUrl, username, password, calendarUrl);

  const reportBody = `<?xml version="1.0" encoding="UTF-8"?>
<sync-collection xmlns="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <sync-token>${syncToken}</sync-token>
  <sync-level>1</sync-level>
  <prop>
    <getetag/>
    <c:calendar-data/>
  </prop>
</sync-collection>`;

  try {
    const response = await fetch(calendarUrl, {
      method: 'REPORT',
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Depth': '1',
        'Authorization': `Basic ${base64Encode(`${username}:${password}`)}`,
        'User-Agent': 'Vividly/1.0',
      },
      body: reportBody,
    });

    if (!response.ok && response.status !== 207) {
      const errorText = await response.text();
      console.error('REPORT(sync-collection) 오류 응답:', errorText.substring(0, 500));
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const xmlText = await response.text();
    let events = parseEventsFromXML(xmlText, calendarColor || '#3b82f6');
    const nextTokenMatch = xmlText.match(/<sync-token[^>]*>([\s\S]*?)<\/sync-token>/i);
    const nextSyncToken = nextTokenMatch ? nextTokenMatch[1].trim() : null;

    // 삭제 여부 감지 (404/410 응답이 있으면 삭제로 판단)
    const hasDeletions = /HTTP\/1\.1\s+(404|410)/i.test(xmlText);

    console.log('sync-collection 응답 길이:', xmlText.length);
    console.log('sync-collection next token:', nextSyncToken ? nextSyncToken.substring(0, 12) + '...' : 'none');

    // calendar-data가 없으면 href로 개별 이벤트를 가져온다
    if (events.length === 0) {
      const hrefs = extractChangedHrefs(xmlText, calendarUrl);
      console.log('sync-collection hrefs:', hrefs.length);
      if (hrefs.length > 0) {
        const fetched = await fetchEventsByHrefs(username, password, calendarUrl, hrefs, calendarColor || '#3b82f6');
        console.log('sync-collection href fetch events:', fetched.length);
        if (fetched.length > 0) {
          events = fetched;
        }
      }
    }

    return { events, syncToken: nextSyncToken, hasDeletions };
  } catch (error: any) {
    console.error('fetchSyncCollection 오류:', error);
    throw new Error(`sync-collection 실패: ${error.message}`);
  }
}

function extractChangedHrefs(xmlText: string, calendarUrl: string): string[] {
  const hrefs: string[] = [];
  const responseRegex = /<(?:d:)?response[^>]*>([\s\S]*?)<\/(?:d:)?response>/gi;
  let match;
  const calendarPath = calendarUrl.replace(/\/+$/, '');

  while ((match = responseRegex.exec(xmlText)) !== null) {
    const responseXml = match[1];
    const statusMatch = responseXml.match(/<status[^>]*>([^<]+)<\/status>/i);
    const statusText = statusMatch ? statusMatch[1] : '';
    if (!/200\s+OK/i.test(statusText)) {
      continue;
    }

    const hrefMatch = responseXml.match(/<(?:d:)?href[^>]*>([^<]+)<\/(?:d:)?href>/i);
    if (!hrefMatch) continue;

    const href = hrefMatch[1].trim();
    if (!href || href.endsWith('/')) continue;

    // 캘린더 컬렉션 href는 제외
    if (href.includes(calendarPath)) {
      // calendarUrl 자체가 포함된 경우도 많아서, 파일로 추정되는 것만 허용
      if (!href.match(/\.ics$/i)) {
        continue;
      }
    }

    hrefs.push(href);
  }

  return hrefs;
}

function buildAbsoluteUrl(calendarUrl: string, href: string): string {
  if (href.startsWith('http')) return href;
  const base = new URL(calendarUrl);
  if (href.startsWith('/')) {
    return `${base.origin}${href}`;
  }
  const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
  return `${base.origin}${basePath}${href}`;
}

async function fetchEventsByHrefs(
  username: string,
  password: string,
  calendarUrl: string,
  hrefs: string[],
  defaultColor: string
): Promise<Omit<Event, 'id'>[]> {
  const events: Omit<Event, 'id'>[] = [];
  for (const href of hrefs) {
    try {
      const absoluteUrl = buildAbsoluteUrl(calendarUrl, href);
      const response = await fetch(absoluteUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${base64Encode(`${username}:${password}`)}`,
          'User-Agent': 'Vividly/1.0',
        },
      });
      if (!response.ok) continue;
      const icalText = await response.text();
// ... existing code ...
    } catch (error) {
       console.error('fetchEventsByHrefs error:', error);
    }
  }
  return events;
}

// ----------------------------------------------------------------------------
// Create / Update Event (PUT)
// ----------------------------------------------------------------------------
async function putEvent(
  serverUrl: string,
  username: string,
  password: string,
  calendarUrl: string,
  eventUid: string,
  eventData: string,
  etag?: string
): Promise<{ success: boolean; etag?: string }> {
  // Ensure calendarUrl ends with /
  const base = calendarUrl.endsWith('/') ? calendarUrl : calendarUrl + '/';
  // Filename usually is UID.ics
  const filename = eventUid.endsWith('.ics') ? eventUid : `${eventUid}.ics`;
  const url = `${base}${filename}`;
  
  const headers: Record<string, string> = {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Authorization': `Basic ${base64Encode(`${username}:${password}`)}`,
    'User-Agent': 'Vividly/1.0',
  };

  if (etag) {
    headers['If-Match'] = `"${etag}"`; // Some servers need quotes
  }

  console.log('PUT requesting:', url);

  const response = await fetch(url, {
    method: 'PUT',
    headers,
    body: eventData,
  });

  if (!response.ok) {
     const text = await response.text();
     console.error('PUT failed:', response.status, text);
     throw new Error(`PUT request failed: ${response.status} ${response.statusText}`);
  }

  const newEtag = response.headers.get('ETag');
  return { success: true, etag: newEtag ? newEtag.replace(/"/g, '') : undefined };
}

// ----------------------------------------------------------------------------
// Delete Event (DELETE)
// ----------------------------------------------------------------------------
async function deleteEvent(
  serverUrl: string,
  username: string,
  password: string,
  calendarUrl: string,
  eventUid: string,
  etag?: string
): Promise<{ success: boolean }> {
  const base = calendarUrl.endsWith('/') ? calendarUrl : calendarUrl + '/';
  const filename = eventUid.endsWith('.ics') ? eventUid : `${eventUid}.ics`;
  const url = `${base}${filename}`;

  const headers: Record<string, string> = {
    'Authorization': `Basic ${base64Encode(`${username}:${password}`)}`,
    'User-Agent': 'Vividly/1.0',
  };

  if (etag) {
    headers['If-Match'] = `"${etag}"`;
  }

  console.log('DELETE requesting:', url);

  const response = await fetch(url, {
    method: 'DELETE',
    headers,
  });

  if (!response.ok && response.status !== 404) { // 404 is technically success (already gone)
     const text = await response.text();
     console.error('DELETE failed:', response.status, text);
     throw new Error(`DELETE request failed: ${response.status}`);
  }

  return { success: true };
}
      const parsed = parseEventsFromICalText(icalText, defaultColor);
      if (parsed.length > 0) {
        events.push(...parsed);
      }
    } catch (error) {
      console.error('이벤트 href 가져오기 실패:', error);
    }
  }
  return events;
}

function parseEventsFromICalText(icalText: string, defaultColor: string): Omit<Event, 'id'>[] {
  const events: Omit<Event, 'id'>[] = [];
  const veventRegex = /BEGIN:VEVENT[\s\S]*?END:VEVENT/g;
  const matches = icalText.match(veventRegex) || [];
  for (const block of matches) {
    const event = parseICalEvent(block, defaultColor);
    if (event) {
      events.push(event);
    }
  }
  return events;
}

// XML에서 이벤트 파싱
function parseEventsFromXML(xmlText: string, defaultColor: string): Omit<Event, 'id'>[] {
  const events: Omit<Event, 'id'>[] = [];
  
  console.log('parseEventsFromXML 시작, XML 길이:', xmlText.length);
  
  // calendar-data에서 iCal 데이터 추출 (여러 네임스페이스 형식 지원)
  // <c:calendar-data>, <calendar-data>, CDATA 포함 등
  const calendarDataRegex = /<(?:c:)?calendar-data[^>]*>([\s\S]*?)<\/(?:c:)?calendar-data>/gi;
  let match;
  let matchCount = 0;

  while ((match = calendarDataRegex.exec(xmlText)) !== null) {
    matchCount++;
    let icalData = match[1].trim();
    
    // CDATA 제거
    if (icalData.startsWith('<![CDATA[') && icalData.endsWith(']]>')) {
      icalData = icalData.slice(9, -3).trim();
    }
    
    // HTML 엔티티 디코딩
    icalData = icalData
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    
    if (!icalData) {
      console.log(`calendar-data ${matchCount}: 비어있음`);
      continue;
    }

    try {
      const event = parseICalEvent(icalData, defaultColor);
      if (event) {
        events.push(event);
      }
    } catch (error: any) {
      console.error(`iCal 파싱 오류 (${matchCount}):`, error.message);
    }
  }

  console.log(`총 ${matchCount}개의 calendar-data 발견, ${events.length}개의 이벤트 파싱 성공`);
  return events;
}

// iCal 데이터를 Event 형식으로 변환
function parseICalEvent(icalData: string, defaultColor: string): Omit<Event, 'id'> | null {
  try {
    // 간단한 iCal 파싱 (실제로는 더 복잡한 파서가 필요)
    // 여러 줄에 걸친 값도 처리 (줄바꿈 후 공백으로 계속되는 경우)
    const uidMatch = icalData.match(/UID(?:;.*?)?:([^\r\n]+)/);
    const summaryMatch = icalData.match(/SUMMARY(?:;.*?)?:([^\r\n]+(?:\r?\n [^\r\n]+)*)/);
    const descriptionMatch = icalData.match(/DESCRIPTION(?:;.*?)?:([^\r\n]+(?:\r?\n [^\r\n]+)*)/);
    const dtstartMatch = icalData.match(/DTSTART(?:;.*?)?:([^\r\n]+)/);
    const dtendMatch = icalData.match(/DTEND(?:;.*?)?:([^\r\n]+)/);
    const colorMatch = icalData.match(/X-APPLE-CALENDAR-COLOR(?:;.*?)?:([^\r\n]+)/);

    if (!dtstartMatch) {
      console.log('DTSTART를 찾을 수 없음');
      return null;
    }
    
    const uid = uidMatch ? uidMatch[1].trim() : undefined;

    // 여러 줄 값 처리 (줄바꿈 후 공백 제거)
    const summary = summaryMatch ? summaryMatch[1].replace(/\r?\n /g, '').trim() : '';
    const description = descriptionMatch ? descriptionMatch[1].replace(/\r?\n /g, '').trim() : '';
    const dtstart = dtstartMatch[1].trim();
    const dtend = dtendMatch ? dtendMatch[1].trim() : undefined;
    // 개별 색상이 있으면 사용, 없으면 defaultColor (캘린더 색상) 사용
    const color = colorMatch 
      ? `#${colorMatch[1].trim().replace('#', '')}` 
      : defaultColor;
    
    // 날짜 파싱
    let startDate: Date;
    let endDate: Date | undefined;

    // ISO 형식 (YYYYMMDDTHHmmss 또는 YYYYMMDD)
    if (dtstart.length === 8) {
      // 날짜만
      const year = parseInt(dtstart.substring(0, 4));
      const month = parseInt(dtstart.substring(4, 6)) - 1;
      const day = parseInt(dtstart.substring(6, 8));
      startDate = new Date(Date.UTC(year, month, day));
    } else if (dtstart.length >= 15) {
      // 날짜 + 시간
      const year = parseInt(dtstart.substring(0, 4));
      const month = parseInt(dtstart.substring(4, 6)) - 1;
      const day = parseInt(dtstart.substring(6, 8));
      const hour = dtstart.length > 8 ? parseInt(dtstart.substring(9, 11) || '0') : 0;
      const minute = dtstart.length > 10 ? parseInt(dtstart.substring(11, 13) || '0') : 0;
      startDate = new Date(Date.UTC(year, month, day, hour, minute));
    } else {
      return null;
    }

    if (dtend) {
      if (dtend.length === 8) {
        const year = parseInt(dtend.substring(0, 4));
        const month = parseInt(dtend.substring(4, 6)) - 1;
        const day = parseInt(dtend.substring(6, 8));
        endDate = new Date(Date.UTC(year, month, day));
      } else if (dtend.length >= 15) {
        const year = parseInt(dtend.substring(0, 4));
        const month = parseInt(dtend.substring(4, 6)) - 1;
        const day = parseInt(dtend.substring(6, 8));
        const hour = dtend.length > 8 ? parseInt(dtend.substring(9, 11) || '0') : 0;
        const minute = dtend.length > 10 ? parseInt(dtend.substring(11, 13) || '0') : 0;
        endDate = new Date(Date.UTC(year, month, day, hour, minute));
      }
    }

    const date = startDate.toISOString().split('T')[0];
    let startTime: string | undefined;
    let endTime: string | undefined;

    if (dtstart.length > 8) {
      startTime = `${String(startDate.getUTCHours()).padStart(2, '0')}:${String(startDate.getUTCMinutes()).padStart(2, '0')}`;
    }
    if (endDate && dtend && dtend.length > 8) {
      endTime = `${String(endDate.getUTCHours()).padStart(2, '0')}:${String(endDate.getUTCMinutes()).padStart(2, '0')}`;
    }

    return {
      date,
      title: summary,
      memo: description || undefined,
      startTime,
      endTime,
      color,
      uid,
    };
  } catch (error) {
    console.error('iCal 파싱 오류:', error);
    return null;
  }
}
