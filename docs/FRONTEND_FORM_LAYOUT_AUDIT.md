# Frontend form and modal layout audit

Scope: frontend layout, control dimensions, spacing and responsive behavior. Existing theme, API payloads, validation, exam behavior, OCR and face verification are preserved.

## Findings and changes

- Shared modal width was 440px. A larger `max-width` on the exam modal could not increase that width. `Modal` now accepts `small`, `medium`, `large` and `extra-large` sizes, with limits of 520, 720, 960 and 1100px.
- Modal headers remain visible while the body scrolls vertically. The body contains horizontal overflow and allows focus rings around controls. Padding is 28px on desktop and 20px on narrow screens; narrow-screen width is 95vw, capped by the selected size.
- Shared inputs, selects and date/time controls have a 50px minimum height, 16px horizontal padding and 16px text. Textareas have a 128px minimum height. Form action buttons have a 48px minimum height.
- Form grids use 24px gaps and `minmax(0, 1fr)`. Two columns are enabled from 1024px; a container narrower than 640px keeps one column even on a wide screen. Labels have 8px spacing above their controls.
- Native date/time controls stay in full-width cells on mobile and tablet. Checkbox lists, long labels, email addresses and OCR values wrap. Footer buttons wrap independently on narrow screens.
- User fields are grouped as name/student code and email/phone. Class create/edit pages use a shared form panel and wrapping action rows, including student enrollment controls.
- Profile review uses a structured detail grid. Review failures, including a stale profile, are shown inside the open dialog with the existing reload action.
- Student profile, phone editing and student-card preview have consistent spacing and responsive field grids. Displayed OCR values and confirmation conditions are unchanged.
- Additional CSS corrections cover question options, live-class creation, random question selection, exam settings, essay/oral grading, monitor filters/detail drawer, call panel and chat controls. Toggle tracks keep their width while their descriptions wrap.

## Modal assignment

| Size | Usage |
| --- | --- |
| Small, 520px | Submit confirmations, class deletion, UI-kit confirmation |
| Medium, 720px | Device setup/settings; default shared modal |
| Large, 960px | Exam create/edit, question create/edit, live-class creation, user create/edit, student profile review |
| Extra large, 1100px | Available for future complex forms; no current form needs this width |

The monitor detail drawer is capped at 720px and 95vw. The call panel is capped at 520px and fits within the viewport.

## Verification

`tests/e2e/form-layout.spec.ts` covers 320, 375, 768, 1024 and 1440px. It checks the actual bounds of form controls, minimum control heights, modal dimensions, date field layout, page/field overflow, long labels and email addresses, scrollable actions, class creation/editing, review-to-edit navigation and disabled confirmation for a mismatching student-card preview.

Existing browser tests additionally cover keyboard focus trapping/restoration, touch menus, local table scrolling, authentication forms, profile approval/rejection/conflict, phone editing and student-card preview/confirmation/error semantics. API responses are fixtures; these checks validate frontend behavior rather than live backend integration.

Final validation: production build and `tsc --noEmit` passed; all 70 browser tests passed in Microsoft Edge against the production preview on port 3100. Twenty of these tests exercise form layouts at the five viewport widths above. The preview server was stopped after verification and its build workspace moved to Windows Temp; the normal development server was left running.

Screenshots from the browser checks:

- [Profile review on desktop](../artifacts/ui-review/form-audit/review-desktop.png)
- [Exam form with long text on desktop](../artifacts/ui-review/form-audit/exam-desktop.png)
- [Exam actions at 320px](../artifacts/ui-review/form-audit/exam-mobile.png)
- [Question form on desktop](../artifacts/ui-review/form-audit/question-desktop.png)
- [Oral grading with long content on tablet](../artifacts/ui-review/form-audit/grading-tablet.png)
- [Student-card preview with long OCR fields on mobile](../artifacts/ui-review/form-audit/student-card-mobile.png)

The exam screenshots show the scrolled action area. Native date/time fields are filled and measured separately by the automated checks.

## Inventory limitations

The current question-bank page contains bank cards and question create/edit forms, but no bank create/edit form. This audit updates the existing UI; it does not add that missing business flow. Browser-native `confirm`/`prompt` dialogs elsewhere use browser rendering and are outside the shared CSS modal system.

## Reproduce

Build the frontend with the normal project environment, then run against the chosen preview server:

```powershell
$env:PLAYWRIGHT_BASE_URL='http://localhost:3100'
$env:PLAYWRIGHT_CHANNEL='msedge'
npx playwright test tests/e2e/form-layout.spec.ts tests/e2e/responsive-ui.spec.ts tests/e2e/profile-verification-requests.spec.ts tests/e2e/student-phone.spec.ts tests/e2e/student-card.spec.ts tests/e2e/auth-ui.spec.ts
```
