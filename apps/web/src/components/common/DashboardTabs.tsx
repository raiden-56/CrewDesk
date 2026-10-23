import { NavLink } from 'react-router';

const TABS = [
  { label: 'Overview', to: '/', end: true },
  { label: 'Team', to: '/team' },
  { label: 'Tasks', to: '/tasks' },
  { label: 'Workflows', to: '/workflows' },
  { label: 'Tools', to: '/tools' },
  { label: 'Approvals', to: '/approvals' },
  { label: 'History', to: '/activity' },
  { label: 'Analytics', to: '/analytics' },
  { label: 'Settings', to: '/settings' },
];

/** Dashboard navigation tabs; each one is a real route. Scrolls horizontally on small screens. */
export function DashboardTabs() {
  return (
    <nav aria-label="Dashboard sections" className="-mx-4 md:mx-0 px-4 md:px-0 overflow-x-auto">
      <div className="flex items-center gap-1 border-b border-border min-w-max">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `px-3 py-2 text-[13px] font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${isActive ? 'border-primary text-primary' : 'border-transparent text-text-3 hover:text-text'}`}>
            {t.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
