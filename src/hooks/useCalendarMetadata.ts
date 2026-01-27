import { useState, useEffect, useCallback } from 'react';
import { CalendarMetadata, getCalendarMetadata, saveLocalCalendarMetadata, normalizeCalendarUrl } from '../services/api';

export const useCalendarMetadata = () => {
  const [calendarMetadata, setCalendarMetadata] = useState<CalendarMetadata[]>([]);
  const [visibleCalendarUrlSet, setVisibleCalendarUrlSet] = useState<Set<string>>(new Set());

  // --- Initial Load Metadata ---
  useEffect(() => {
    const metaMap = getCalendarMetadata();
    const metaList = Object.values(metaMap);
    setCalendarMetadata(metaList);
    
    // Explicit typing/filtering to avoid undefined in map
    const visible = new Set(
        metaList
        .filter(c => c.isVisible !== false)
        .map(c => normalizeCalendarUrl(c.url))
        .filter((url): url is string => !!url)
    );
    // Default local calendar
    if (!visible.has('local')) visible.add('local');
    setVisibleCalendarUrlSet(visible);
  }, []);

  const toggleCalendarVisibility = useCallback((url: string) => {
      setVisibleCalendarUrlSet(prev => {
          const next = new Set(prev);
          if (next.has(url)) next.delete(url);
          else next.add(url);
          return next;
      });
  }, []);

  const addLocalCalendar = useCallback((name: string, color: string) => {
    const newCal: CalendarMetadata = {
      url: `local-${Date.now()}`,
      displayName: name,
      color,
      isVisible: true,
      isLocal: true,
    };
    setCalendarMetadata(prev => {
      const next = [...prev, newCal];
      saveLocalCalendarMetadata(next);
      return next;
    });
    setVisibleCalendarUrlSet(prev => new Set(prev).add(newCal.url));
    return newCal.url;
  }, []);

  const updateLocalCalendar = useCallback((url: string, updates: Partial<CalendarMetadata>) => {
    setCalendarMetadata(prev => {
      const next = prev.map(c => c.url === url ? { ...c, ...updates } : c);
      saveLocalCalendarMetadata(next);
      return next;
    });
  }, []);

  const deleteLocalCalendar = useCallback((url: string) => {
    setCalendarMetadata(prev => {
      const next = prev.filter(c => c.url !== url);
      saveLocalCalendarMetadata(next);
      return next;
    });
  }, []);

  return {
    calendarMetadata,
    visibleCalendarUrlSet,
    setVisibleCalendarUrlSet,
    toggleCalendarVisibility,
    addLocalCalendar,
    updateLocalCalendar,
    deleteLocalCalendar,
  };
};
