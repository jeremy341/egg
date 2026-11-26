import type { Icon } from "@phosphor-icons/react";
import {
  ChartLineUpIcon,
  ClockCounterClockwiseIcon,
  GaugeIcon,
  CubeIcon,
  GearSixIcon,
  ShieldWarningIcon,
  BookOpenTextIcon,
  FolderOpenIcon,
  KeyIcon,
  TerminalWindowIcon,
  CubeFocusIcon,
  CodeIcon,
  GlobeSimpleIcon,
  UsersThreeIcon,
  HardDrivesIcon,
  HouseLineIcon,
  ListDashesIcon,
  PlusIcon,
  SquaresFourIcon,
  UserCircleIcon,
} from "@phosphor-icons/react";

export type NavItem = {
  href: string;
  label: string;
  icon: Icon;
  /** Returns true when this item should be marked current for the pathname. */
  active: (pathname: string) => boolean;
};

/**
 * The docs sit in the sidebar's bottom group (with Nest guides and the account
 * menu) at every level, team or project, so they are not part of TEAM_ITEMS.
 */
export const DOCS_ITEM: NavItem = {
  href: "/docs",
  label: "Docs",
  icon: BookOpenTextIcon,
  active: (p) => p === "/docs" || p.startsWith("/docs/"),
};

export type NavContext = {
  /** Text shown centred in the top bar on phones, and the single crumb on team pages. */
  title: string;
  /** Desktop breadcrumb label for the page inside a project ("Overview", "Deployments"...). */
  crumb?: string;
  /** Short deployment id on the deployment detail page. */
  deploymentId?: string;
  /** Where the phone's back chevron goes, if this is a nested page. */
  backHref?: string;
  /** Label for the sidebar's way back to the team level. */
  backLabel?: string;
  items: NavItem[];
  project?: { slug: string; name: string };
};

const TEAM_ITEMS: NavItem[] = [
  {
    href: "/projects",
    label: "Projects",
    icon: SquaresFourIcon,
    active: (p) => p === "/projects",
  },
  {
    href: "/grafts",
    label: "Apps",
    icon: SquaresFourIcon,
    active: (p) => p === "/grafts" || p.startsWith("/grafts/"),
  },
  {
    href: "/deployments",
    label: "Deployments",
    icon: CubeIcon,
    active: (p) => p.startsWith("/deployments"),
  },
  {
    href: "/logs",
    label: "Logs",
    icon: ListDashesIcon,
    active: (p) => p.startsWith("/logs"),
  },
  {
    href: "/resources",
    label: "Resources",
    icon: GaugeIcon,
    active: (p) => p.startsWith("/resources"),
  },
  {
    href: "/domains",
    label: "Domains",
    icon: GlobeSimpleIcon,
    active: (p) => p.startsWith("/domains"),
  },
  {
    href: "/organizations",
    label: "Organizations",
    icon: UsersThreeIcon,
    active: (p) => p.startsWith("/organizations"),
  },
  {
    href: "/activity",
    label: "Activity",
    icon: ClockCounterClockwiseIcon,
    active: (p) => p.startsWith("/activity"),
  },
  {
    href: "/container",
    label: "Container",
    icon: CubeFocusIcon,
    active: (p) => p.startsWith("/container"),
  },
  {
    href: "/developer",
    label: "Developer",
    icon: CodeIcon,
    active: (p) => p.startsWith("/developer"),
  },
  {
    href: "/connect",
    label: "Connect",
    icon: HardDrivesIcon,
    active: (p) => p.startsWith("/connect"),
  },
  {
    href: "/keys",
    label: "Keys",
    icon: KeyIcon,
    active: (p) => p.startsWith("/keys"),
  },
];

const TEAM_TITLES: Record<string, string> = {
  "/projects": "Projects",
  "/grafts": "Apps",
  "/deployments": "Deployments",
  "/logs": "Logs",
  "/resources": "Resources",
  "/domains": "Domains",
  "/organizations": "Organizations",
  "/activity": "Activity",
  "/container": "Container",
  "/developer": "Developer",
  "/connect": "Connect a server",
  "/keys": "Keys",
};

function projectItems(slug: string): NavItem[] {
  const base = `/projects/${slug}`;
  return [
    {
      href: base,
      label: "Overview",
      icon: HouseLineIcon,
      active: (p) => p === base,
    },
    {
      href: `${base}/deployments`,
      label: "Deployments",
      icon: CubeIcon,
      active: (p) => p.startsWith(`${base}/deployments`),
    },
    {
      href: `${base}/analytics`,
      label: "Analytics",
      icon: ChartLineUpIcon,
      active: (p) => p.startsWith(`${base}/analytics`),
    },
    {
      href: `${base}/files`,
      label: "Files",
      icon: FolderOpenIcon,
      active: (p) => p.startsWith(`${base}/files`),
    },
    {
      href: `${base}/terminal`,
      label: "Terminal",
      icon: TerminalWindowIcon,
      active: (p) => p.startsWith(`${base}/terminal`),
    },
    {
      href: `${base}/settings`,
      label: "Settings",
      icon: GearSixIcon,
      active: (p) => p.startsWith(`${base}/settings`),
    },
  ];
}

/** True where the page itself carries the "New project" button, so the top bar menu would repeat it. */
export function hasOwnCreateButton(pathname: string): boolean {
  return pathname === "/projects";
}

export function navFor(pathname: string): NavContext {
  const match = pathname.match(/^\/projects\/([^/]+)(\/.*)?$/);

  if (match) {
    const slug = match[1];
    const rest = match[2] ?? "";
    const name = slug;

    let title = "Project overview";
    let crumb = "Overview";
    let deploymentId: string | undefined;
    let backHref = "/projects";
    if (rest.startsWith("/deployments/")) {
      title = "Deployment";
      crumb = "Deployment";
      deploymentId = rest.split("/")[2]?.slice(0, 8);
      backHref = `/projects/${slug}/deployments`;
    } else if (rest.startsWith("/analytics")) {
      title = "Project analytics";
      crumb = "Analytics";
      backHref = `/projects/${slug}`;
    } else if (rest.startsWith("/files")) {
      title = "Files";
      crumb = "Files";
      backHref = `/projects/${slug}`;
    } else if (rest.startsWith("/terminal")) {
      title = "Terminal";
      crumb = "Terminal";
      backHref = `/projects/${slug}`;
    } else if (rest.startsWith("/settings")) {
      title = "Project settings";
      crumb = "Settings";
      backHref = `/projects/${slug}`;
    } else if (rest.startsWith("/deployments")) {
      title = "Project deployments";
      crumb = "Deployments";
      backHref = `/projects/${slug}`;
    } else {
      backHref = "/projects";
    }

    return {
      title,
      crumb,
      deploymentId,
      backHref,
      backLabel: "All projects",
      items: projectItems(slug),
      project: { slug, name },
    };
  }

  if (DOCS_ITEM.active(pathname)) {
    return { title: "Docs", backHref: "/projects", items: TEAM_ITEMS };
  }

  if (pathname.startsWith("/account")) {
    return { title: "Account", backHref: "/projects", items: TEAM_ITEMS };
  }
  if (pathname.startsWith("/admin")) {
    return { title: "Administration", backHref: "/projects", items: TEAM_ITEMS };
  }

  if (pathname.startsWith("/grafts/")) {
    const segments = pathname.slice("/grafts/".length).split("/");
    const graft = segments[0];
    const labels: Record<string, string> = {
      announcements: "Announcements",
      forum: segments.length > 1 ? "Forum topic" : "Forum",
      greenhouse: segments.length > 1 ? "Greenhouse workspace" : "Greenhouse",
    };
    const title = labels[graft] ?? "Apps";
    const backHref = graft === "forum" && segments.length > 1
      ? "/grafts/forum"
      : graft === "greenhouse" && segments.length > 1
        ? "/grafts/greenhouse"
        : "/grafts";
    return { title, crumb: title, backHref, backLabel: "Apps", items: TEAM_ITEMS };
  }

  if (pathname.startsWith("/settings")) {
    return { title: "Settings", backHref: "/projects", items: TEAM_ITEMS };
  }

  const known = TEAM_ITEMS.find((i) => i.active(pathname));
  return {
    title: TEAM_TITLES[known?.href ?? "/projects"] ?? "Egg",
    backHref: pathname === "/projects" ? undefined : "/projects",
    items: TEAM_ITEMS,
  };
}

export type FindTarget = {
  href: string;
  label: string;
  group: string;
  /** Leading icon for pages. Projects use a PixelAvatar seeded with `seed`. */
  icon?: Icon;
  seed?: string;
};

/** Everything the Find palette can jump to. */
export function findTargets(
  projects: { slug: string; name: string }[]
): FindTarget[] {
  return [
    ...TEAM_ITEMS.map((i) => ({
      href: i.href,
      label: i.label,
      group: "Pages",
      icon: i.icon,
    })),
    { href: "/account", label: "Account", group: "Pages", icon: UserCircleIcon },
    { href: "/settings", label: "Settings", group: "Pages", icon: GearSixIcon },
    { href: "/security/report", label: "Report a vulnerability", group: "Pages", icon: ShieldWarningIcon },
    { href: "/new", label: "New project", group: "Pages", icon: PlusIcon },
    { href: DOCS_ITEM.href, label: DOCS_ITEM.label, group: "Pages", icon: DOCS_ITEM.icon },
    ...projects.map((p) => ({
      href: `/projects/${p.slug}`,
      label: p.name,
      group: "Projects",
      seed: p.slug,
    })),
  ];
}
