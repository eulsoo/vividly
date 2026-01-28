import { Event } from '../types';
import { createEvent } from './api';
import ICAL from 'ical.js';

/**
 * ICS 파일을 파싱하여 이벤트 배열로 변환
 */
export function parseICSFile(icsContent: string): Omit<Event, 'id'>[] {
  const events: Omit<Event, 'id'>[] = [];
  
  try {
    const jcalData = ICAL.parse(icsContent);
    const comp = new ICAL.Component(jcalData);
    
    // 모든 VEVENT 컴포넌트 찾기
    const vevents = comp.getAllSubcomponents('vevent');
    
    for (const vevent of vevents) {
      const parsed = parseICalEvent(vevent);
      if (parsed) {
        events.push(parsed);
      }
    }
  } catch (error) {
    console.error('ICS 파일 파싱 실패:', error);
    throw new Error('ICS 파일 형식이 올바르지 않습니다.');
  }
  
  return events;
}

/**
 * ICAL Component를 Event 형식으로 변환
 */
function parseICalEvent(vevent: ICAL.Component): Omit<Event, 'id'> | null {
  try {
    const summary = (vevent.getFirstPropertyValue('summary') || '') as string;
    const description = (vevent.getFirstPropertyValue('description') || '') as string;
    const dtstart = vevent.getFirstPropertyValue('dtstart') as any;
    const dtend = vevent.getFirstPropertyValue('dtend') as any;
    const color = (vevent.getFirstPropertyValue('color') || '#3b82f6') as string;
    
    if (!dtstart) return null;
    
    const startDate = dtstart.toJSDate();
    const date = startDate.toISOString().split('T')[0];
    
    let startTime: string | undefined;
    let endTime: string | undefined;
    
    // 시간 정보가 있는 경우 (하루 종일 이벤트가 아닌 경우)
    if (dtstart.isDate === false) {
      startTime = formatTime(startDate);
    }
    
    if (dtend && dtend.isDate === false) {
      endTime = formatTime(dtend.toJSDate());
    }
    
    return {
      date,
      title: summary || '(제목 없음)',
      memo: description || undefined,
      startTime,
      endTime,
      color,
    };
  } catch (error) {
    console.error('iCal 이벤트 파싱 실패:', error);
    return null;
  }
}

function formatTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * ICS 파일을 읽어서 이벤트를 가져오고 데이터베이스에 저장
 */
export async function importICSFile(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      try {
        const icsContent = e.target?.result as string;
        const events = parseICSFile(icsContent);
        
        let importedCount = 0;
        for (const event of events) {
          const result = await createEvent(event);
          if (result) importedCount++;
        }
        
        resolve(importedCount);
      } catch (error: any) {
        reject(new Error(error.message || 'ICS 파일을 가져올 수 없습니다.'));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('파일을 읽을 수 없습니다.'));
    };
    
    reader.readAsText(file);
  });
}

/**
 * URL에서 ICS를 가져와서 지정된 기간 내의 이벤트를 파싱 (RRULE 지원)
 */
export async function fetchAndParseICS(url: string, rangeStart: Date, rangeEnd: Date): Promise<Omit<Event, 'id'>[]> {
  try {
    // CORS 프록시 사용 (corsproxy.io)
    // Note: corsproxy.io requires the URL to be partially encoded or just plain depending on special chars.
    // Encoding usually safer.
    const proxyUrl = 'https://corsproxy.io/?' + encodeURIComponent(url);
    const text = await fetch(proxyUrl).then(r => {
      if (!r.ok) throw new Error('Fetch failed: ' + r.status);
      return r.text();
    });

    const jcalData = ICAL.parse(text);
    const comp = new ICAL.Component(jcalData);
    const vevents = comp.getAllSubcomponents('vevent');
    
    const events: Omit<Event, 'id'>[] = [];

    for (const vevent of vevents) {
      const event = new ICAL.Event(vevent);
      const summary = event.summary;
      const description = event.description;
      const uid = event.uid;
      
      if (event.isRecurring()) {
        const iterator = event.iterator();
        let next;
        let count = 0;
        
        while ((next = iterator.next())) {
            const dt = (next as any).toJSDate();
            
            if (dt < rangeStart) continue;
            if (dt > rangeEnd) break;
            
            events.push({
                date: dt.toISOString().split('T')[0],
                title: summary,
                memo: description,
                color: '#EF4444',
                calendarUrl: url,
                caldavUid: uid ? `${uid}-${dt.getTime()}` : undefined // Recurrence ID substitute
            } as any);
            
            count++;
            if (count > 2000) break;
        }
      } else {
        const dt = event.startDate.toJSDate();
        if (dt >= rangeStart && dt <= rangeEnd) {
           events.push({
                date: dt.toISOString().split('T')[0],
                title: summary,
                memo: description,
                color: '#EF4444',
                calendarUrl: url,
                caldavUid: uid
           } as any);
        }
      }
    }
    return events;
  } catch (e) {
    console.error('Error fetching/parsing ICS:', e);
    return [];
  }
}

/**
 * Event 객체를 ICS 문자열로 변환 (CalDAV PUT 요청용)
 */
export function serializeEventToICS(event: Partial<Event>): string {
  const comp = new ICAL.Component(['vcalendar', [], []]);
  comp.updatePropertyWithValue('prodid', '-//Vividly App//KR');
  comp.updatePropertyWithValue('version', '2.0');

  const vevent = new ICAL.Component('vevent');
  const icalEvent = new ICAL.Event(vevent);

  icalEvent.summary = event.title || '새로운 일정';
  icalEvent.description = event.memo || '';
  // UID: 서버가 생성한 걸 써야 하지만, 최초 생성시는 클라이언트가 만들어 보내기도 함.
  icalEvent.uid = event.caldavUid || `vividly-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // 날짜/시간 설정
  if (event.date) {
    if (event.startTime && event.endTime) {
      // 시간 지정 이벤트
      const start = ICAL.Time.fromJSDate(new Date(`${event.date}T${event.startTime}`));
      const end = ICAL.Time.fromJSDate(new Date(`${event.date}T${event.endTime}`));
      icalEvent.startDate = start;
      icalEvent.endDate = end;
    } else {
      // 종일 이벤트
      const start = ICAL.Time.fromJSDate(new Date(event.date));
      start.isDate = true;
      icalEvent.startDate = start;
       
      // 종일 이벤트는 종료일이 다음날 자정이어야 함 (일반적인 컨벤션)
      const nextDay = new Date(event.date);
      nextDay.setDate(nextDay.getDate() + 1);
      const end = ICAL.Time.fromJSDate(nextDay);
      end.isDate = true;
      icalEvent.endDate = end;
    }
  }

  // DTSTAMP (Created/Modified Time to now)
  const now = ICAL.Time.now();
  vevent.updatePropertyWithValue('dtstamp', now);

  comp.addSubcomponent(vevent);
  return comp.toString();
}
