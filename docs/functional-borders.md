# Functional borders

Borders describe the box's purpose or an explicit attention state. Generic filters, mixed dashboards and ordinary containers retain the neutral border. Chart-series colors and existing backgrounds are independent of this classification.

| Role | Purpose | Light | Dark |
| --- | --- | --- | --- |
| `users` | Users, accounts, identity and profiles | `#4D94DE` | `#7EB0E8` |
| `classes` | Classes, teaching and live lessons | `#19A69C` | `#62C4BB` |
| `exams` | Exams, questions, question banks and attempts | `#A184DF` | `#B6A0E8` |
| `warning` | Warnings, pending review and monitoring anomalies | `#E6A545` | `#E9B96D` |
| `success` | Completed work, correct answers and resolved states | `#4CAF78` | `#7CC79B` |
| `danger` | Errors, wrong answers and confirmed/high-priority incidents | `#DC7474` | `#E6A0A0` |
| `neutral` | Unclassified or mixed-purpose containers | `#B8CDD2` | `#3E5C66` |

Primitives and hover variants live in `app/proctoowl-theme.css`; `app/functional-borders.css` maps the roles to the rendered boundary. They do not change background, padding, radius, border thickness, layout or text. Existing 1px borders stay 1px; existing emphasized edges retain their widths.

Use `borderRole="users"` on `Card`, `ChartCard` or `KpiCard`. Ordinary boxes omit the prop. `Card` defaults an existing `role="alert"` to `danger`; an explicit `borderRole="warning"` overrides that default where the alert is a warning. For existing native elements use `borderProps('classes')` from `components/ui/Border` without adding a wrapper; merge its style if the element already has inline styles.

An explicit attention state can take precedence over a functional category, such as a monitored exam with recorded warnings. Keep icons, labels, status text and existing accessibility semantics. Do not derive roles from array position, random values, chart-series colors or displayed text.

The opt-in inline `borderColor` consumes a CSS variable so existing CSS-module variants cannot accidentally erase the role. It changes only color, and callers can retain an explicit style override. Nested unclassified cards keep their normal border; role variables do not recolor controls, charts or other descendants.

The support inbox frame and conversation-list divider use `users`; a resolved conversation summary uses `success`. The inbox page has isolated presentation in `components/chat/AdminInbox.module.css`; shared conversation and drawer styles remain in `SupportChat.module.css`. Public feature cards follow the same functional categories; authentication cards use `users`.
