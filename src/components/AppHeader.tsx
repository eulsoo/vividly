import { ChevronRight, X } from 'lucide-react';
import { RefObject } from 'react';
import styles from '../App.module.css';

interface AppHeaderProps {
  currentYear: number;
  currentMonth: number;
  avatarUrl: string | null;
  userInitial: string;
  profileMenuRef: RefObject<HTMLDivElement | null>;
  isProfileMenuOpen: boolean;
  onScrollToToday: () => void;
  onToggleProfileMenu: () => void;
  onOpenRoutine: () => void;
  onOpenCalDAV: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
  showRoutines: boolean;
  onToggleRoutines: () => void;
  showTodos: boolean;
  onToggleTodos: () => void;
}

export function AppHeader({
  currentYear,
  currentMonth,
  avatarUrl,
  userInitial,
  profileMenuRef,
  isProfileMenuOpen,
  onScrollToToday,
  onToggleProfileMenu,
  onOpenRoutine,
  onOpenCalDAV,
  onOpenSettings,
  onLogout,
  showRoutines,
  onToggleRoutines,
  showTodos,
  onToggleTodos,
}: AppHeaderProps) {
  return (
    <div className={styles.appHeader}>
      <div className={styles.appHeaderContent}>
        <div className={styles.appHeaderLeft}>
          <h1 className={styles.appHeaderTitle}>
            {currentYear}년 {currentMonth}월
          </h1>
          <button
            onClick={onScrollToToday}
            className={`${styles.appHeaderButton} ${styles.appHeaderButtonToday}`}
          >
            오늘
          </button>
        </div>

        <div className={styles.appHeaderRight}>
          <div className={styles.profileWrapper} ref={profileMenuRef}>
            {/* 썸네일: 메뉴가 열려있지 않을 때만 표시 */}
            {!isProfileMenuOpen && (
              <button
                onClick={onToggleProfileMenu}
                className={styles.profileButton}
                aria-haspopup="menu"
                aria-expanded={isProfileMenuOpen}
                style={
                  avatarUrl
                    ? { backgroundImage: `url(${avatarUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                    : undefined
                }
              >
                {!avatarUrl && (
                  <span className={styles.profileInitial}>
                    {userInitial}
                  </span>
                )}
              </button>
            )}
            {isProfileMenuOpen && (
              <div className={styles.profileMenu} role="menu">
                {/* 헤더 (제목 + 닫기 버튼) */}
                <div className={styles.profileHeader}>
                  <span className={styles.profileTitle}>계정</span>
                  <button onClick={onToggleProfileMenu} className={styles.profileCloseButton}>
                    <X size={18} />
                  </button>
                </div>

                {/* 루틴 관리 */}
                <div className={styles.profileMenuItemGroup}>
                  <div className={styles.profileMenuToggleWrapper}>
                    <label className={styles.toggleSwitch}>
                      <input
                        type="checkbox"
                        checked={showRoutines}
                        onChange={onToggleRoutines}
                      />
                      <span className={styles.toggleSlider}></span>
                    </label>
                  </div>
                  <button
                    className={styles.profileMenuItemWithIcon}
                    onClick={onOpenRoutine}
                  >
                    <span>루틴 관리</span>
                    <ChevronRight size={16} />
                  </button>
                </div>

                {/* 투두 리스트 */}
                <div className={styles.profileMenuItemGroup}>
                  <div className={styles.profileMenuToggleWrapper}>
                    <label className={styles.toggleSwitch}>
                      <input
                        type="checkbox"
                        checked={showTodos}
                        onChange={onToggleTodos}
                      />
                      <span className={styles.toggleSlider}></span>
                    </label>
                  </div>
                  <div className={styles.profileMenuItemWithIcon} style={{ cursor: 'default' }}>
                    <span>투두 리스트</span>
                  </div>
                </div>

                <div className={styles.profileMenuDivider} style={{ height: '1px', backgroundColor: '#e5e7eb', margin: '0.25rem 0' }} />

                <button className={styles.profileMenuItem} onClick={onOpenCalDAV}>
                  맥 캘린더 동기화
                </button>
                <button className={styles.profileMenuItem} onClick={onOpenSettings}>
                  설정
                </button>
                <button className={styles.profileMenuItem} onClick={onLogout}>
                  로그아웃
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
