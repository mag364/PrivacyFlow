# PrivacyFlow-Inspired Application Blueprint Prompt

Use this prompt to create a new application with the visual quality, layout discipline, and interaction polish of PrivacyFlow without copying PrivacyFlow's business domain or assuming that the new product manages records.

## How to use it

1. Copy the master prompt below into a new project conversation.
2. Complete the project brief at the bottom of the prompt.
3. Attach or reference PrivacyFlow when the coding environment can inspect it. If it cannot, the visual and engineering specifications below are sufficient to establish the intended direction.
4. Remove any optional requirement that does not apply to the new product.

The project brief controls the product. The blueprint controls visual consistency, interaction quality, and engineering standards.

---

## Copyable master prompt

```text
Create a polished application using the PrivacyFlow-inspired UI and engineering blueprint defined below.

CORE RULE

Build only the product described in the Project Brief. Do not infer that the application manages records, cases, projects, customers, tasks, workflows, or logs. Do not introduce a database, dashboard, table, CRUD interface, status model, or Settings screen unless the Project Brief requires it.

The PrivacyFlow reference supplies the design language and quality standard—not the new application's business model.

DO NOT ADD BY DEFAULT

Unless explicitly requested in the Project Brief, do not add:

- Authentication, accounts, sign-in, or password management
- Roles, permissions, or access-control systems
- Audit history, activity logs, or tamper-evident logging
- Approval workflows or Approval TTL settings
- Workflow statuses, queues, assignments, or lifecycle tracking
- Records, cases, projects, contacts, or generic CRUD management
- Automation rules, email templates, or scheduled actions
- Reports, analytics dashboards, metrics, or charts
- External links, third-party integrations, or API connections
- Backup and restore systems
- Imports or exports
- Notifications or reminders
- Persistent storage when the product can work without it
- Demo data presented as real functionality
- Placeholder controls, navigation items, or buttons that do nothing

PRODUCT DISCOVERY

Before implementation, derive the application's information architecture from the Project Brief. Identify:

- The primary user goal
- The smallest set of screens or workspaces needed to accomplish it
- The main user actions and their expected outcomes
- Whether the product needs persistence at all
- Whether it should run in a browser, Electron desktop shell, or both
- Which settings are genuinely useful
- What success, empty, loading, and error states are relevant

If a missing decision would materially change the product, ask a concise question. Otherwise, make a reasonable product-specific assumption, state it, and continue.

DESIGN DIRECTION

Use a calm, premium, desktop-oriented visual language inspired by PrivacyFlow:

- Layer translucent surfaces over a subtle radial-gradient background.
- Use restrained blue accents, soft borders, rounded corners, and understated shadows.
- Keep layouts spacious but information-efficient.
- Prefer clear hierarchy and quiet surfaces over decorative visual noise.
- Use familiar controls and concise labels. The interface should feel immediately understandable.
- Apply glass effects selectively. Dense content should use a stable, more opaque surface for readability.
- Use icons to reinforce meaning, not as decoration or replacements for essential labels.
- Avoid excessive gradients, oversized marketing typography, glowing effects, animated flourishes, and unnecessary cards.

DEFAULT VISUAL TOKENS

Create semantic CSS variables so branding and themes can change without rewriting components. Use the following as the starting palette, renaming the variable prefix for the new application:

Dark theme:
- Background: #0b1020
- Background gradient A: #101a36
- Background gradient B: #0a0e1c
- Glass surface: rgba(24, 32, 56, 0.62)
- Secondary surface: rgba(30, 40, 68, 0.55)
- Solid surface: #141b30
- Primary text: #eef2fb
- Muted text: #9aa6c4
- Border: rgba(148, 170, 220, 0.16)
- Highlight: rgba(255, 255, 255, 0.08)
- Accent: #6ea8ff
- Accent foreground: #071021

Light theme:
- Background: #eef1f8
- Background gradient A: #ffffff
- Background gradient B: #dde5f4
- Glass surface: rgba(255, 255, 255, 0.68)
- Secondary surface: rgba(255, 255, 255, 0.82)
- Solid surface: #ffffff
- Primary text: #131a2b
- Muted text: #5a6786
- Border: rgba(20, 40, 90, 0.12)
- Highlight: rgba(255, 255, 255, 0.70)
- Accent: #2f6bff
- Accent foreground: #ffffff

Base styling:
- Typeface: Inter with system sans-serif fallback
- Main surface radius: 18px
- Form-control radius: approximately 12px
- Capsule controls and badges: fully rounded
- Glass blur: approximately 18px with moderate saturation
- Standard shadow: 0 8px 30px rgba(0, 0, 0, 0.35) in dark mode
- Large shadow: 0 24px 60px rgba(0, 0, 0, 0.45) in dark mode
- Fast interaction timing: approximately 120ms
- Standard interaction timing: approximately 200ms
- Easing: cubic-bezier(0.22, 1, 0.36, 1)

Treat these as a coherent starting system, not mandatory branding. Adjust the accent and background palette when the Project Brief specifies a different brand while preserving contrast, hierarchy, spacing, and surface behavior.

REUSABLE COMPONENT SYSTEM

Build a small set of consistent primitives before assembling feature screens. Include only components the product uses. Likely primitives include:

- Surface or panel
- Interactive card
- Primary, subtle, ghost, and destructive buttons
- Text input, select, textarea, checkbox, and other brief-specific controls
- Field wrapper with label, hint, and inline validation error
- Badge or compact status indicator only when the product has meaningful states
- Page header with a concise title, supporting text, and optional actions
- Modal or confirmation dialog only when an action requires interruption or confirmation
- Loading indicator
- Empty state with a useful explanation and next action
- Inline error and success feedback
- Tooltip for unfamiliar icon-only controls

All controls must have consistent sizing, disabled behavior, focus treatment, keyboard access, and error presentation. Do not create multiple visual variants that serve the same purpose.

APPLICATION SHELL

Derive the shell from the product rather than forcing every application into the same navigation model:

- Use a sidebar when the product has several stable top-level destinations.
- Use a compact header or toolbar when the product is focused on one primary workspace.
- Use tabs only for closely related views within the same context.
- Use a focused canvas, editor, wizard, or split-pane layout when that better fits the product.
- Do not create Dashboard or Settings destinations merely to fill navigation space.
- If Settings is needed, include only real user-configurable preferences. Do not include Approval TTL, security, role, audit, backup, integration, or storage controls unless explicitly required.
- Keep primary actions visible and secondary actions quieter.
- Make the current location obvious without relying only on color.

For Electron applications, a custom title bar may include the application icon, product name, a short context label when useful, and standard minimize/maximize/close controls. Do not add workspace locks, sync indicators, authentication controls, or update indicators unless the Project Brief calls for them.

RESPONSIVE BEHAVIOR

- Design desktop and mobile layouts intentionally; do not merely shrink the desktop view.
- Collapse or replace the sidebar appropriately on narrow screens.
- Allow forms and toolbars to stack without awkward wrapping.
- Keep primary actions reachable and content readable at common laptop widths.
- Prevent long text, URLs, and filenames from escaping their containers.
- Use horizontal scrolling only for content that genuinely cannot reflow.
- Maintain usable touch targets and spacing on mobile devices.

ACCESSIBILITY

- Use semantic HTML and native controls whenever practical.
- Every interactive element must be keyboard accessible.
- Provide a clear focus-visible ring using the accent color.
- Do not rely on color alone to communicate meaning.
- Associate form labels and error messages with their controls.
- Maintain readable contrast in dark and light themes.
- Respect prefers-reduced-motion.
- If transparency is configurable, provide an opaque-surface mode.
- Use accessible names for icon-only controls.

INTERACTION QUALITY

- Every visible action must work.
- Give immediate feedback after meaningful actions.
- Preserve user input when an operation fails.
- Use inline validation for correctable field errors.
- Reserve confirmation dialogs for destructive or difficult-to-reverse actions.
- Disable controls only when necessary and explain unavailable actions when the reason is not obvious.
- Avoid blocking alerts when an inline or non-modal message is sufficient.
- Keep transitions brief and purposeful.
- Write interface copy in plain language using the terminology from the Project Brief.

TECHNICAL FOUNDATION

Use these defaults unless the Project Brief or existing repository requires something else:

- React
- TypeScript with strict type checking
- Vite
- Tailwind CSS
- React Router only when multiple routes are useful
- Lucide icons
- Vitest for unit tests
- Electron only when a desktop application is requested

Engineering requirements:

- Keep business logic separate from presentational components.
- Centralize semantic design tokens.
- Prefer small, composable components over large duplicated screens.
- Use shared types for important domain concepts.
- Add persistence only when the product requires data to survive reloads or restarts.
- When persistence is needed, choose the simplest reliable option appropriate to the product and runtime.
- Do not carry PrivacyFlow-specific names, variable prefixes, data models, permissions, or compliance behavior into the new application.
- Avoid speculative abstractions for features not in the brief.
- Preserve existing repository conventions when extending an established project.

IMPLEMENTATION PROCESS

1. Inspect the existing repository and any supplied reference application.
2. Summarize the proposed product structure and note any important assumptions.
3. Identify the minimal routes, screens, components, and state required by the Project Brief.
4. Establish semantic design tokens and reusable primitives.
5. Implement the complete primary user journey before secondary refinements.
6. Add relevant loading, empty, validation, success, and error states.
7. Verify responsive and keyboard behavior.
8. Test important business logic and fragile interactions.
9. Run the full test and production build commands.
10. Report what was implemented, what was verified, and any intentional limitations.

QUALITY BAR

The finished application should:

- Feel related to PrivacyFlow through layout discipline, glass surfaces, component consistency, typography, and interaction polish.
- Feel purpose-built for the new product rather than reskinned from a record-management application.
- Contain no PrivacyFlow terminology or privacy-specific behavior unless explicitly requested.
- Contain no unused navigation, fake metrics, nonfunctional actions, or speculative enterprise features.
- Be understandable without documentation for the primary journey.
- Handle realistic content lengths and edge cases.
- Pass its tests and production build.

PROJECT BRIEF

Application name:
[Name]

One-sentence purpose:
[What the application helps a user accomplish]

Primary users:
[Who will use it; omit accounts or roles unless access control is genuinely required]

Primary user journey:
[Describe the main task from beginning to successful completion]

Required capabilities:
- [Capability]
- [Capability]
- [Capability]

Explicitly excluded capabilities:
- [Anything this application must not include]

Content or information the application works with:
[Describe only if applicable; it may be transient rather than stored]

Required screens or workspaces:
[List them, or state that the builder should propose the minimal structure]

Navigation preference:
[Sidebar, toolbar, tabs, single workspace, wizard, builder should decide, etc.]

Persistence:
[None, session-only, browser-local, local files, database, or builder should recommend]

Target runtime:
[Browser, Electron desktop, both, or builder should recommend]

Branding:
[Logo, accent color, theme preferences, or use blueprint defaults]

Settings genuinely needed:
[List only useful user-configurable preferences, or none]

Important input, output, or file formats:
[If applicable]

Accessibility or device requirements:
[If applicable]

Acceptance criteria:
- [Observable outcome]
- [Observable outcome]
- [Observable outcome]

Additional constraints:
[Technical, operational, or design constraints]
```

## Recommended project-brief principle

Describe what the new application must help someone accomplish before naming screens or technical features. This allows the builder to select an interface suited to the product instead of defaulting to dashboards, tables, records, or administrative settings.

Examples of products this blueprint can support include focused utilities, calculators, editors, guided tools, media applications, configuration interfaces, visual workspaces, single-purpose desktop tools, and content-driven applications. None of those patterns should be assumed until the project brief calls for one.
