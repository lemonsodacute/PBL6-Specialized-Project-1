(globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push([typeof document === "object" ? document.currentScript : undefined,
"[project]/lib/calendar-date.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// Keep the exam availability window separate from the attempt duration.
__turbopack_context__.s([
    "formatCalendarDate",
    ()=>formatCalendarDate,
    "formatCalendarDateTime",
    ()=>formatCalendarDateTime,
    "formatCalendarTime",
    ()=>formatCalendarTime
]);
const formatCalendarTime = (value)=>value.toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit'
    });
const formatCalendarDate = (value)=>value.toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
function formatCalendarDateTime(value) {
    if (!value) return 'Chưa có thông tin';
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? "".concat(formatCalendarTime(date), " ").concat(formatCalendarDate(date)) : 'Chưa có thông tin';
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/components/student/StudentExams.module.css [app-client] (css module)", ((__turbopack_context__) => {

__turbopack_context__.v({
  "card": "StudentExams-module__37tYJq__card",
  "description": "StudentExams-module__37tYJq__description",
  "eyebrow": "StudentExams-module__37tYJq__eyebrow",
  "hero": "StudentExams-module__37tYJq__hero",
  "heroAside": "StudentExams-module__37tYJq__heroAside",
  "owl": "StudentExams-module__37tYJq__owl",
  "page": "StudentExams-module__37tYJq__page",
  "schedule": "StudentExams-module__37tYJq__schedule",
  "softCard": "StudentExams-module__37tYJq__softCard",
  "today": "StudentExams-module__37tYJq__today",
});
}),
"[project]/components/student/StudentExamCard.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "StudentExamCard",
    ()=>StudentExamCard
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$navigation$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/navigation.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/components/ui/index.ts [app-client] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Badge$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/ui/Badge.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/ui/Button.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Card$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/ui/Card.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$clock$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Clock$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/clock.mjs [app-client] (ecmascript) <export default as Clock>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$circle$2d$check$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__CircleCheck$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/circle-check.mjs [app-client] (ecmascript) <export default as CircleCheck>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$clipboard$2d$list$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__ClipboardList$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/clipboard-list.mjs [app-client] (ecmascript) <export default as ClipboardList>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$camera$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Camera$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/camera.mjs [app-client] (ecmascript) <export default as Camera>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$mic$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Mic$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/mic.mjs [app-client] (ecmascript) <export default as Mic>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$circle$2d$question$2d$mark$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__CircleHelp$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/circle-question-mark.mjs [app-client] (ecmascript) <export default as CircleHelp>");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$studentExamStatus$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/studentExamStatus.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$calendar$2d$date$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/calendar-date.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$StudentExams$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__ = __turbopack_context__.i("[project]/components/student/StudentExams.module.css [app-client] (css module)");
;
var _s = __turbopack_context__.k.signature();
'use client';
;
;
;
;
;
;
function StudentExamCard(param) {
    let { exam, state, classView = false, playful = false } = param;
    var _exam_classes;
    _s();
    const router = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$navigation$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRouter"])(), target = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$studentExamStatus$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["studentExamActionTarget"])(exam, state);
    const attempt = state.attempt;
    const finalScore = attempt ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$studentExamStatus$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getStudentFinalScore"])(attempt) : null;
    const soft = playful && (state.status === 'open' || state.status === 'upcoming');
    const statusBadge = /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Badge$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["StatusBadge"], {
        status: state.status,
        label: state.label
    }, void 0, false, {
        fileName: "[project]/components/student/StudentExamCard.tsx",
        lineNumber: 16,
        columnNumber: 21
    }, this);
    var _exam_description, _attempt_max_score;
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Card$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Card"], {
        borderRole: "exams",
        className: "student-exam-card ".concat(playful ? __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$StudentExams$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].card : '', " ").concat(soft ? __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$StudentExams$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].softCard : ''),
        "data-exam-status": state.status,
        "data-chat-avoid": true,
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "student-exam-card-top",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "study-set-mark",
                        "aria-hidden": "true",
                        children: state.status === 'upcoming' ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$clock$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Clock$3e$__["Clock"], {
                            size: 22
                        }, void 0, false, {
                            fileName: "[project]/components/student/StudentExamCard.tsx",
                            lineNumber: 17,
                            columnNumber: 285
                        }, this) : state.status === 'ended' ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$circle$2d$check$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__CircleCheck$3e$__["CircleCheck"], {
                            size: 22
                        }, void 0, false, {
                            fileName: "[project]/components/student/StudentExamCard.tsx",
                            lineNumber: 17,
                            columnNumber: 327
                        }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$clipboard$2d$list$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__ClipboardList$3e$__["ClipboardList"], {
                            size: 22
                        }, void 0, false, {
                            fileName: "[project]/components/student/StudentExamCard.tsx",
                            lineNumber: 17,
                            columnNumber: 352
                        }, this)
                    }, void 0, false, {
                        fileName: "[project]/components/student/StudentExamCard.tsx",
                        lineNumber: 17,
                        columnNumber: 207
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("h3", {
                                children: exam.title
                            }, void 0, false, {
                                fileName: "[project]/components/student/StudentExamCard.tsx",
                                lineNumber: 18,
                                columnNumber: 5
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                                children: classView ? (_exam_description = exam.description) !== null && _exam_description !== void 0 ? _exam_description : 'Đề thi của lớp' : ((_exam_classes = exam.classes) === null || _exam_classes === void 0 ? void 0 : _exam_classes.map((item)=>item.name).join(', ')) || 'Đề thi cá nhân'
                            }, void 0, false, {
                                fileName: "[project]/components/student/StudentExamCard.tsx",
                                lineNumber: 18,
                                columnNumber: 26
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/components/student/StudentExamCard.tsx",
                        lineNumber: 17,
                        columnNumber: 385
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/components/student/StudentExamCard.tsx",
                lineNumber: 17,
                columnNumber: 168
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "student-exam-meta",
                children: [
                    soft && state.status === 'upcoming' && statusBadge,
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        children: [
                            playful && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$clock$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Clock$3e$__["Clock"], {
                                size: 16,
                                "aria-hidden": "true"
                            }, void 0, false, {
                                fileName: "[project]/components/student/StudentExamCard.tsx",
                                lineNumber: 19,
                                columnNumber: 112
                            }, this),
                            !soft && 'Thời lượng làm bài: ',
                            exam.duration_minutes,
                            " phút"
                        ]
                    }, void 0, true, {
                        fileName: "[project]/components/student/StudentExamCard.tsx",
                        lineNumber: 19,
                        columnNumber: 96
                    }, this),
                    exam.questions_count !== undefined && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        children: [
                            playful && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$circle$2d$question$2d$mark$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__CircleHelp$3e$__["CircleHelp"], {
                                size: 16,
                                "aria-hidden": "true"
                            }, void 0, false, {
                                fileName: "[project]/components/student/StudentExamCard.tsx",
                                lineNumber: 19,
                                columnNumber: 267
                            }, this),
                            exam.questions_count,
                            " câu"
                        ]
                    }, void 0, true, {
                        fileName: "[project]/components/student/StudentExamCard.tsx",
                        lineNumber: 19,
                        columnNumber: 251
                    }, this),
                    exam.require_camera && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Badge$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Badge"], {
                        children: [
                            playful && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$camera$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Camera$3e$__["Camera"], {
                                size: 16,
                                "aria-hidden": "true"
                            }, void 0, false, {
                                fileName: "[project]/components/student/StudentExamCard.tsx",
                                lineNumber: 19,
                                columnNumber: 383
                            }, this),
                            "Camera"
                        ]
                    }, void 0, true, {
                        fileName: "[project]/components/student/StudentExamCard.tsx",
                        lineNumber: 19,
                        columnNumber: 366
                    }, this),
                    exam.require_mic && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Badge$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Badge"], {
                        children: [
                            playful && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$mic$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Mic$3e$__["Mic"], {
                                size: 16,
                                "aria-hidden": "true"
                            }, void 0, false, {
                                fileName: "[project]/components/student/StudentExamCard.tsx",
                                lineNumber: 19,
                                columnNumber: 473
                            }, this),
                            "Microphone"
                        ]
                    }, void 0, true, {
                        fileName: "[project]/components/student/StudentExamCard.tsx",
                        lineNumber: 19,
                        columnNumber: 456
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/components/student/StudentExamCard.tsx",
                lineNumber: 19,
                columnNumber: 15
            }, this),
            (!soft || state.status !== 'upcoming') && statusBadge,
            playful ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("dl", {
                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$StudentExams$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].schedule,
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("dt", {
                                children: "Thời gian mở"
                            }, void 0, false, {
                                fileName: "[project]/components/student/StudentExamCard.tsx",
                                lineNumber: 21,
                                columnNumber: 51
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("dd", {
                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("time", {
                                    dateTime: exam.start_time,
                                    children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$calendar$2d$date$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatCalendarDateTime"])(exam.start_time)
                                }, void 0, false, {
                                    fileName: "[project]/components/student/StudentExamCard.tsx",
                                    lineNumber: 21,
                                    columnNumber: 76
                                }, this)
                            }, void 0, false, {
                                fileName: "[project]/components/student/StudentExamCard.tsx",
                                lineNumber: 21,
                                columnNumber: 72
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/components/student/StudentExamCard.tsx",
                        lineNumber: 21,
                        columnNumber: 46
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("dt", {
                                children: "Hạn làm bài"
                            }, void 0, false, {
                                fileName: "[project]/components/student/StudentExamCard.tsx",
                                lineNumber: 21,
                                columnNumber: 173
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("dd", {
                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("time", {
                                    dateTime: exam.end_time,
                                    children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$calendar$2d$date$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatCalendarDateTime"])(exam.end_time)
                                }, void 0, false, {
                                    fileName: "[project]/components/student/StudentExamCard.tsx",
                                    lineNumber: 21,
                                    columnNumber: 197
                                }, this)
                            }, void 0, false, {
                                fileName: "[project]/components/student/StudentExamCard.tsx",
                                lineNumber: 21,
                                columnNumber: 193
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/components/student/StudentExamCard.tsx",
                        lineNumber: 21,
                        columnNumber: 168
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/components/student/StudentExamCard.tsx",
                lineNumber: 21,
                columnNumber: 14
            }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                className: "student-exam-note",
                children: [
                    "Thời gian mở: ",
                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$calendar$2d$date$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatCalendarDateTime"])(exam.start_time),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("br", {}, void 0, false, {
                        fileName: "[project]/components/student/StudentExamCard.tsx",
                        lineNumber: 21,
                        columnNumber: 379
                    }, this),
                    "Hạn làm bài: ",
                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$calendar$2d$date$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatCalendarDateTime"])(exam.end_time)
                ]
            }, void 0, true, {
                fileName: "[project]/components/student/StudentExamCard.tsx",
                lineNumber: 21,
                columnNumber: 291
            }, this),
            state.status === 'in_progress' && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                className: "student-exam-note",
                children: [
                    "Còn lại khoảng ",
                    (attempt === null || attempt === void 0 ? void 0 : attempt.server_deadline_at) ? "".concat(Math.floor(Math.max(0, (Date.parse(attempt.server_deadline_at) - Date.now()) / 60000)), " phút") : '—'
                ]
            }, void 0, true, {
                fileName: "[project]/components/student/StudentExamCard.tsx",
                lineNumber: 22,
                columnNumber: 36
            }, this),
            state.action === 'result' && attempt && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                className: "student-exam-score",
                children: finalScore === null ? 'Đang chờ chấm' : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Fragment"], {
                    children: [
                        "Điểm: ",
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("strong", {
                            children: [
                                finalScore,
                                " / ",
                                (_attempt_max_score = attempt.max_score) !== null && _attempt_max_score !== void 0 ? _attempt_max_score : '—'
                            ]
                        }, void 0, true, {
                            fileName: "[project]/components/student/StudentExamCard.tsx",
                            lineNumber: 23,
                            columnNumber: 117
                        }, this)
                    ]
                }, void 0, true)
            }, void 0, false, {
                fileName: "[project]/components/student/StudentExamCard.tsx",
                lineNumber: 23,
                columnNumber: 40
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "student-exam-actions",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                        variant: state.action === 'result' ? 'outline' : 'primary',
                        disabled: !target,
                        onClick: ()=>{
                            if (target) router.push(target);
                        },
                        children: state.actionLabel
                    }, void 0, false, {
                        fileName: "[project]/components/student/StudentExamCard.tsx",
                        lineNumber: 24,
                        columnNumber: 43
                    }, this),
                    state.canRetry && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                        variant: "warning",
                        onClick: ()=>router.push("/student/exams/".concat(encodeURIComponent(exam.id), "/verify")),
                        children: "Làm lại"
                    }, void 0, false, {
                        fileName: "[project]/components/student/StudentExamCard.tsx",
                        lineNumber: 25,
                        columnNumber: 24
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/components/student/StudentExamCard.tsx",
                lineNumber: 24,
                columnNumber: 5
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/components/student/StudentExamCard.tsx",
        lineNumber: 17,
        columnNumber: 10
    }, this);
}
_s(StudentExamCard, "SRruSwemo3TCQPpHAmAnAa0T7W0=", false, function() {
    return [
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$navigation$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRouter"],
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$navigation$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRouter"]
    ];
});
_c = StudentExamCard;
var _c;
__turbopack_context__.k.register(_c, "StudentExamCard");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/components/student/useStudentExamRefresh.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useStudentExamRefresh",
    ()=>useStudentExamRefresh
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var _s = __turbopack_context__.k.signature();
'use client';
;
function useStudentExamRefresh(reload, studentId) {
    _s();
    const [now, setNow] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(Date.now());
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "useStudentExamRefresh.useEffect": ()=>{
            if (!studentId) return;
            const refresh = {
                "useStudentExamRefresh.useEffect.refresh": ()=>{
                    if (document.visibilityState === 'visible') void reload(true);
                }
            }["useStudentExamRefresh.useEffect.refresh"];
            const submitted = {
                "useStudentExamRefresh.useEffect.submitted": (event)=>{
                    const detail = event.detail;
                    if (!(detail === null || detail === void 0 ? void 0 : detail.studentId) || detail.studentId === studentId) refresh();
                }
            }["useStudentExamRefresh.useEffect.submitted"];
            const clock = window.setInterval({
                "useStudentExamRefresh.useEffect.clock": ()=>setNow(Date.now())
            }["useStudentExamRefresh.useEffect.clock"], 1000), poll = window.setInterval(refresh, 15_000);
            window.addEventListener('focus', refresh);
            document.addEventListener('visibilitychange', refresh);
            window.addEventListener('student-exam-updated', submitted);
            return ({
                "useStudentExamRefresh.useEffect": ()=>{
                    window.clearInterval(clock);
                    window.clearInterval(poll);
                    window.removeEventListener('focus', refresh);
                    document.removeEventListener('visibilitychange', refresh);
                    window.removeEventListener('student-exam-updated', submitted);
                }
            })["useStudentExamRefresh.useEffect"];
        }
    }["useStudentExamRefresh.useEffect"], [
        reload,
        studentId
    ]);
    return now;
}
_s(useStudentExamRefresh, "rWt7hBRl+kBpqd7S02B6z/zbhz8=");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/lib/uiErrors.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "friendlyError",
    ()=>friendlyError
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/api.ts [app-client] (ecmascript)");
;
function friendlyError(cause) {
    let fallback = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : 'Không thể hoàn tất thao tác. Vui lòng thử lại.';
    if (!(cause instanceof __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ApiError"])) return cause instanceof TypeError ? 'Không thể kết nối đến máy chủ. Vui lòng thử lại.' : fallback;
    if (cause.status === 0 || cause.status === 408) return 'Không thể kết nối đến máy chủ. Vui lòng thử lại.';
    if (cause.status === 429) return 'Bạn đã thử quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.';
    if (cause.code === 'EMAIL_EXISTS') return 'Email này đã được sử dụng.';
    if (cause.code === 'STUDENT_ALREADY_ENROLLED' || cause.code === 'ALREADY_ENROLLED') return 'Sinh viên này đã thuộc lớp.';
    if (cause.code === 'ORAL_EXAMS_DISABLED') return 'Hình thức thi này đã ngừng hỗ trợ. Vui lòng dùng câu hỏi trắc nghiệm hoặc tự luận.';
    if (cause.code === 'INVALID_CREDENTIALS') return 'Email hoặc mật khẩu không chính xác.';
    if (cause.code === 'INVALID_RESET_TOKEN') return 'Mã đặt lại không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu mã mới.';
    var _cause_code;
    if ([
        'ACCOUNT_DISABLED',
        'USER_INACTIVE',
        'ACCOUNT_INACTIVE'
    ].includes((_cause_code = cause.code) !== null && _cause_code !== void 0 ? _cause_code : '')) return 'Tài khoản hiện không thể đăng nhập.';
    if (cause.status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
    if (cause.status === 403) return 'Bạn không có quyền thực hiện thao tác này.';
    if (cause.status === 422) return 'Thông tin chưa hợp lệ. Vui lòng kiểm tra các trường và thử lại.';
    return fallback;
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/lib/collections.ts [app-client] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useCollectionState",
    ()=>useCollectionState,
    "useServerCollection",
    ()=>useServerCollection
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$uiErrors$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/uiErrors.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$collection$2d$query$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/collection-query.ts [app-client] (ecmascript)");
var _s = __turbopack_context__.k.signature(), _s1 = __turbopack_context__.k.signature();
'use client';
;
;
;
;
function useCollectionState() {
    let defaultFilters = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {}, defaultSort = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : 'newest', persist = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : true;
    _s();
    const defaults = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])({
        q: '',
        page: '1',
        limit: '20',
        sort: defaultSort,
        ...defaultFilters
    });
    const [values, setValues] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(defaults.current);
    const [ready, setReady] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const [debounced, setDebounced] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])('');
    const currentValues = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(values);
    currentValues.current = values;
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "useCollectionState.useEffect": ()=>{
            if (!persist) {
                setReady(true);
                return;
            }
            function read() {
                const query = new URLSearchParams(location.search);
                const next = {
                    ...defaults.current
                };
                Object.keys(next).forEach({
                    "useCollectionState.useEffect.read": (key)=>{
                        if (query.has(key)) next[key] = query.get(key);
                    }
                }["useCollectionState.useEffect.read"]);
                if (!/^[1-9]\d*$/.test(next.page)) next.page = '1';
                if (![
                    '20',
                    '50',
                    '100'
                ].includes(next.limit)) next.limit = '20';
                setValues(next);
                setDebounced(next.q.trim());
                setReady(true);
            }
            read();
            window.addEventListener('popstate', read);
            return ({
                "useCollectionState.useEffect": ()=>window.removeEventListener('popstate', read)
            })["useCollectionState.useEffect"];
        }
    }["useCollectionState.useEffect"], []);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "useCollectionState.useEffect": ()=>{
            const timer = setTimeout({
                "useCollectionState.useEffect.timer": ()=>setDebounced(values.q.trim())
            }["useCollectionState.useEffect.timer"], 350);
            return ({
                "useCollectionState.useEffect": ()=>clearTimeout(timer)
            })["useCollectionState.useEffect"];
        }
    }["useCollectionState.useEffect"], [
        values.q
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "useCollectionState.useEffect": ()=>{
            if (!ready || !persist) return;
            const query = new URLSearchParams(location.search);
            Object.keys(defaults.current).forEach({
                "useCollectionState.useEffect": (key)=>{
                    const raw = values[key];
                    const value = key === 'q' ? raw.trim() : raw;
                    if (!value || value === defaults.current[key]) query.delete(key);
                    else query.set(key, value);
                }
            }["useCollectionState.useEffect"]);
            const target = location.pathname + (query.size ? '?' + query.toString() : '') + location.hash;
            if (target !== location.pathname + location.search + location.hash) window.history.replaceState(window.history.state, '', target);
        }
    }["useCollectionState.useEffect"], [
        values,
        ready,
        persist
    ]);
    const serialized = JSON.stringify({
        ...values,
        q: debounced,
        page: Number(values.page),
        limit: Number(values.limit)
    });
    const params = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useMemo"])({
        "useCollectionState.useMemo[params]": ()=>JSON.parse(serialized)
    }["useCollectionState.useMemo[params]"], [
        serialized
    ]);
    const set = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useCollectionState.useCallback[set]": (key, value)=>{
            // A filter/page action applies the current search immediately. Otherwise
            // the request can combine new filters with the previous debounced query.
            if (key !== 'q') setDebounced(currentValues.current.q.trim());
            setValues({
                "useCollectionState.useCallback[set]": (current)=>({
                        ...current,
                        [key]: value,
                        ...key === 'page' ? {} : {
                            page: '1'
                        }
                    })
            }["useCollectionState.useCallback[set]"]);
        }
    }["useCollectionState.useCallback[set]"], []);
    const clear = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useCollectionState.useCallback[clear]": ()=>{
            setValues({
                ...defaults.current
            });
            setDebounced('');
        }
    }["useCollectionState.useCallback[clear]"], []);
    const active = Object.entries(defaults.current).some((param)=>{
        let [key, value] = param;
        return ![
            'page',
            'limit',
            'sort'
        ].includes(key) && (key === 'q' ? values.q.trim() : values[key]) !== value;
    });
    return {
        values,
        params,
        ready,
        set,
        clear,
        active,
        pending: values.q.trim() !== debounced,
        key: (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$collection$2d$query$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["listQuery"])(params)
    };
}
_s(useCollectionState, "JozpYEPf+Po+aN7grfRNWvm/nNk=");
function useServerCollection(state, loader) {
    let message = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : 'Không tải được danh sách. Vui lòng thử lại.', scope = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : '';
    _s1();
    const [rows, setRows] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])([]);
    const [meta, setMeta] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])();
    const [loading, setLoading] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(true);
    const [error, setError] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])('');
    const request = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(0);
    const latest = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])({
        loader,
        params: state.params,
        message,
        set: state.set
    });
    latest.current = {
        loader,
        params: state.params,
        message,
        set: state.set
    };
    const reload = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useServerCollection.useCallback[reload]": async function() {
            let background = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : false;
            const version = ++request.current;
            if (!background) {
                setLoading(true);
                setRows([]);
            }
            setError('');
            try {
                const result = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$collection$2d$query$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["readCollection"])(await latest.current.loader(latest.current.params));
                if (version === request.current) {
                    var _result_meta;
                    var _latest_current_params_limit;
                    const lastPage = ((_result_meta = result.meta) === null || _result_meta === void 0 ? void 0 : _result_meta.total) !== undefined ? Math.max(1, Math.ceil(result.meta.total / Number((_latest_current_params_limit = latest.current.params.limit) !== null && _latest_current_params_limit !== void 0 ? _latest_current_params_limit : 20))) : null;
                    if (lastPage !== null && Number(latest.current.params.page) > lastPage) {
                        latest.current.set('page', String(lastPage));
                        return;
                    }
                    setRows(result.data);
                    setMeta(result.meta);
                }
            } catch (cause) {
                if (version === request.current) {
                    setRows([]);
                    setError((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$uiErrors$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["friendlyError"])(cause, latest.current.message));
                    setMeta(undefined);
                }
            } finally{
                if (version === request.current) setLoading(false);
            }
        }
    }["useServerCollection.useCallback[reload]"], []);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "useServerCollection.useEffect": ()=>{
            if (state.ready) void reload();
            return ({
                "useServerCollection.useEffect": ()=>{
                    request.current++;
                }
            })["useServerCollection.useEffect"];
        }
    }["useServerCollection.useEffect"], [
        state.key,
        state.ready,
        reload,
        scope
    ]);
    var _meta_total;
    return {
        rows,
        meta,
        total: (_meta_total = meta === null || meta === void 0 ? void 0 : meta.total) !== null && _meta_total !== void 0 ? _meta_total : null,
        loading: loading || state.pending,
        error,
        reload
    };
}
_s1(useServerCollection, "KFTLRePwxvj7x1kgDbKtFAFRNNY=");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/components/collections/CollectionToolbar.module.css [app-client] (css module)", ((__turbopack_context__) => {

__turbopack_context__.v({
  "actions": "CollectionToolbar-module___0OfPa__actions",
  "clearSearch": "CollectionToolbar-module___0OfPa__clearSearch",
  "empty": "CollectionToolbar-module___0OfPa__empty",
  "extraFilters": "CollectionToolbar-module___0OfPa__extraFilters",
  "field": "CollectionToolbar-module___0OfPa__field",
  "lookupControl": "CollectionToolbar-module___0OfPa__lookupControl",
  "mascotActions": "CollectionToolbar-module___0OfPa__mascotActions",
  "pageSize": "CollectionToolbar-module___0OfPa__pageSize",
  "pages": "CollectionToolbar-module___0OfPa__pages",
  "pagination": "CollectionToolbar-module___0OfPa__pagination",
  "search": "CollectionToolbar-module___0OfPa__search",
  "searchField": "CollectionToolbar-module___0OfPa__searchField",
  "toolbar": "CollectionToolbar-module___0OfPa__toolbar",
  "toolbarMascot": "CollectionToolbar-module___0OfPa__toolbarMascot",
  "toolbarWithActions": "CollectionToolbar-module___0OfPa__toolbarWithActions",
});
}),
"[project]/components/collections/RemoteFilterSelect.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "RemoteFilterSelect",
    ()=>RemoteFilterSelect
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$search$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Search$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/search.mjs [app-client] (ecmascript) <export default as Search>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/api.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$collection$2d$query$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/collection-query.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/components/ui/index.ts [app-client] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Field$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/ui/Field.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/ui/Button.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__ = __turbopack_context__.i("[project]/components/collections/CollectionToolbar.module.css [app-client] (css module)");
;
var _s = __turbopack_context__.k.signature();
'use client';
;
;
;
;
;
;
;
const label = (item)=>{
    var _item_name, _item_student_code, _ref;
    return (_ref = (_item_name = item.name) !== null && _item_name !== void 0 ? _item_name : item.title) !== null && _ref !== void 0 ? _ref : [
        item.full_name,
        (_item_student_code = item.student_code) !== null && _item_student_code !== void 0 ? _item_student_code : item.email
    ].filter(Boolean).join(' · ');
};
function RemoteFilterSelect(param) {
    let { source, label: heading, value, onChange, classId, refreshKey = 0, disabled = false } = param;
    _s();
    const [query, setQuery] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])('');
    const [items, setItems] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])([]);
    const [selected, setSelected] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    const [error, setError] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const [retry, setRetry] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(0);
    const [loadedScope, setLoadedScope] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(''), [selectedScope, setSelectedScope] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])('');
    const selectionScope = "".concat(source, "|").concat(classId !== null && classId !== void 0 ? classId : '', "|").concat(refreshKey);
    const scope = "".concat(selectionScope, "|").concat(query.trim(), "|").concat(retry);
    const loading = loadedScope !== scope, visibleItems = loading ? [] : items;
    const [searchOpen, setSearchOpen] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "RemoteFilterSelect.useEffect": ()=>{
            let active = true;
            const timer = setTimeout({
                "RemoteFilterSelect.useEffect.timer": async ()=>{
                    try {
                        const params = {
                            q: query.trim(),
                            page: 1,
                            limit: 20,
                            sort: 'name'
                        };
                        const response = source === 'classes' ? await __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["api"].classes.list(params) : source === 'exams' ? await __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["api"].exams.list(params) : source === 'teachers' ? await __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["api"].users.list({
                            ...params,
                            role: 'teacher'
                        }) : classId ? await __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["api"].classes.availableStudents(classId, params) : null;
                        if (active) {
                            setItems((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$collection$2d$query$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["readCollection"])(response).data);
                            setError(false);
                            setLoadedScope(scope);
                        }
                    } catch (e) {
                        if (active) {
                            setItems([]);
                            setError(true);
                            setLoadedScope(scope);
                        }
                    }
                }
            }["RemoteFilterSelect.useEffect.timer"], 350);
            return ({
                "RemoteFilterSelect.useEffect": ()=>{
                    active = false;
                    clearTimeout(timer);
                }
            })["RemoteFilterSelect.useEffect"];
        }
    }["RemoteFilterSelect.useEffect"], [
        query,
        source,
        classId,
        retry,
        refreshKey,
        scope
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "RemoteFilterSelect.useEffect": ()=>{
            if (!value) {
                setSelected(null);
                return;
            }
            let active = true;
            const found = loadedScope === scope ? items.find({
                "RemoteFilterSelect.useEffect": (item)=>item.id === value
            }["RemoteFilterSelect.useEffect"]) : null;
            if (found) {
                setSelected(found);
                setSelectedScope(selectionScope);
                return;
            }
            if (source === 'students') {
                setSelected({
                    "RemoteFilterSelect.useEffect": (current)=>(current === null || current === void 0 ? void 0 : current.id) === value ? current : null
                }["RemoteFilterSelect.useEffect"]);
                return;
            }
            ({
                "RemoteFilterSelect.useEffect": async ()=>{
                    try {
                        const response = source === 'classes' ? await __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["api"].classes.get(value, {
                            include_students: false
                        }) : source === 'teachers' ? await __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["api"].users.get(value) : await __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["api"].exams.list({
                            exam_id: value,
                            page: 1,
                            limit: 20
                        });
                        const option = source === 'exams' ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$collection$2d$query$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["readCollection"])(response).data[0] : response.data;
                        if (active) {
                            setSelected(option !== null && option !== void 0 ? option : null);
                            setSelectedScope(selectionScope);
                        }
                    } catch (e) {
                        if (active) setSelected(null);
                    }
                }
            })["RemoteFilterSelect.useEffect"]();
            return ({
                "RemoteFilterSelect.useEffect": ()=>{
                    active = false;
                }
            })["RemoteFilterSelect.useEffect"];
        }
    }["RemoteFilterSelect.useEffect"], [
        value,
        items,
        source,
        loadedScope,
        scope,
        selectionScope
    ]);
    const currentSelected = selectedScope === selectionScope ? selected : null;
    const options = currentSelected && !visibleItems.some((item)=>item.id === currentSelected.id) ? [
        currentSelected,
        ...visibleItems
    ] : visibleItems;
    const empty = source === 'students' && !loading && !error && options.length === 0;
    const placeholder = source !== 'students' ? 'Tất cả' : loading ? 'Đang tải sinh viên...' : empty ? query.trim() ? 'Không tìm thấy sinh viên phù hợp.' : 'Không còn sinh viên để thêm.' : 'Chọn sinh viên';
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].field,
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                children: heading
            }, void 0, false, {
                fileName: "[project]/components/collections/RemoteFilterSelect.tsx",
                lineNumber: 42,
                columnNumber: 40
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].lookupControl,
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Field$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Select"], {
                        "aria-label": heading,
                        value: value,
                        disabled: disabled || loading || empty || error,
                        "aria-busy": loading || undefined,
                        onChange: (event)=>onChange(event.target.value),
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("option", {
                                value: "",
                                children: placeholder
                            }, void 0, false, {
                                fileName: "[project]/components/collections/RemoteFilterSelect.tsx",
                                lineNumber: 43,
                                columnNumber: 169
                            }, this),
                            value && !options.some((item)=>item.id === value) && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("option", {
                                value: value,
                                disabled: true,
                                children: "Lựa chọn không còn khả dụng"
                            }, void 0, false, {
                                fileName: "[project]/components/collections/RemoteFilterSelect.tsx",
                                lineNumber: 43,
                                columnNumber: 254
                            }, this),
                            options.map((item)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("option", {
                                    value: item.id,
                                    children: label(item)
                                }, item.id, false, {
                                    fileName: "[project]/components/collections/RemoteFilterSelect.tsx",
                                    lineNumber: 43,
                                    columnNumber: 341
                                }, this))
                        ]
                    }, void 0, true, {
                        fileName: "[project]/components/collections/RemoteFilterSelect.tsx",
                        lineNumber: 43,
                        columnNumber: 5
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["IconButton"], {
                        label: "Tìm ".concat(heading.toLowerCase()),
                        disabled: disabled,
                        "aria-expanded": searchOpen,
                        onClick: ()=>setSearchOpen((value)=>!value),
                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$search$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Search$3e$__["Search"], {
                            size: 18,
                            "aria-hidden": "true"
                        }, void 0, false, {
                            fileName: "[project]/components/collections/RemoteFilterSelect.tsx",
                            lineNumber: 44,
                            columnNumber: 146
                        }, this)
                    }, void 0, false, {
                        fileName: "[project]/components/collections/RemoteFilterSelect.tsx",
                        lineNumber: 44,
                        columnNumber: 5
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/components/collections/RemoteFilterSelect.tsx",
                lineNumber: 42,
                columnNumber: 62
            }, this),
            (searchOpen || query) && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Field$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Input"], {
                autoFocus: true,
                disabled: disabled,
                type: "search",
                "aria-label": "Tìm ".concat(heading.toLowerCase()),
                placeholder: "Tìm ".concat(heading.toLowerCase(), "..."),
                value: query,
                onChange: (event)=>setQuery(event.target.value)
            }, void 0, false, {
                fileName: "[project]/components/collections/RemoteFilterSelect.tsx",
                lineNumber: 45,
                columnNumber: 27
            }, this),
            empty && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                role: "status",
                children: query.trim() ? 'Không tìm thấy sinh viên phù hợp.' : 'Không còn sinh viên để thêm.'
            }, void 0, false, {
                fileName: "[project]/components/collections/RemoteFilterSelect.tsx",
                lineNumber: 46,
                columnNumber: 13
            }, this),
            !loading && error && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                role: "alert",
                children: [
                    "Không tải được lựa chọn. ",
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                        disabled: disabled,
                        variant: "ghost",
                        size: "sm",
                        onClick: ()=>setRetry((value)=>value + 1),
                        children: "Thử lại"
                    }, void 0, false, {
                        fileName: "[project]/components/collections/RemoteFilterSelect.tsx",
                        lineNumber: 47,
                        columnNumber: 67
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/components/collections/RemoteFilterSelect.tsx",
                lineNumber: 47,
                columnNumber: 23
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/components/collections/RemoteFilterSelect.tsx",
        lineNumber: 42,
        columnNumber: 10
    }, this);
}
_s(RemoteFilterSelect, "Onk6qL2aEQ42aWjjipufdaZ+LMA=");
_c = RemoteFilterSelect;
var _c;
__turbopack_context__.k.register(_c, "RemoteFilterSelect");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/components/collections/CollectionToolbar.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "CollectionPagination",
    ()=>CollectionPagination,
    "CollectionToolbar",
    ()=>CollectionToolbar,
    "EmptySearchState",
    ()=>EmptySearchState,
    "SearchInput",
    ()=>SearchInput,
    "commonSorts",
    ()=>commonSorts
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$search$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Search$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/search.mjs [app-client] (ecmascript) <export default as Search>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$x$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__X$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/x.mjs [app-client] (ecmascript) <export default as X>");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/components/ui/index.ts [app-client] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/ui/Button.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Field$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/ui/Field.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Feedback$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/ui/Feedback.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__ = __turbopack_context__.i("[project]/components/collections/CollectionToolbar.module.css [app-client] (css module)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$RemoteFilterSelect$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/collections/RemoteFilterSelect.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$brand$2f$ProctoOwlMascot$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/brand/ProctoOwlMascot.tsx [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature(), _s1 = __turbopack_context__.k.signature();
'use client';
;
;
;
;
;
;
function SearchInput(param) {
    let { label, placeholder, value, onChange } = param;
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("label", {
        className: "".concat(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].field, " ").concat(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].searchField),
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                children: label
            }, void 0, false, {
                fileName: "[project]/components/collections/CollectionToolbar.tsx",
                lineNumber: 13,
                columnNumber: 69
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].search,
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$search$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Search$3e$__["Search"], {
                        size: 18,
                        "aria-hidden": "true"
                    }, void 0, false, {
                        fileName: "[project]/components/collections/CollectionToolbar.tsx",
                        lineNumber: 13,
                        columnNumber: 120
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Field$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Input"], {
                        type: "search",
                        "aria-label": label,
                        placeholder: placeholder,
                        value: value,
                        onChange: (event)=>onChange(event.target.value)
                    }, void 0, false, {
                        fileName: "[project]/components/collections/CollectionToolbar.tsx",
                        lineNumber: 13,
                        columnNumber: 159
                    }, this),
                    value && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                        className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].clearSearch,
                        type: "button",
                        "aria-label": "Xóa từ khóa tìm kiếm",
                        onClick: ()=>onChange(''),
                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$x$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__X$3e$__["X"], {
                            size: 18,
                            "aria-hidden": "true"
                        }, void 0, false, {
                            fileName: "[project]/components/collections/CollectionToolbar.tsx",
                            lineNumber: 13,
                            columnNumber: 409
                        }, this)
                    }, void 0, false, {
                        fileName: "[project]/components/collections/CollectionToolbar.tsx",
                        lineNumber: 13,
                        columnNumber: 295
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/components/collections/CollectionToolbar.tsx",
                lineNumber: 13,
                columnNumber: 89
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/components/collections/CollectionToolbar.tsx",
        lineNumber: 13,
        columnNumber: 10
    }, this);
}
_c = SearchInput;
function CollectionToolbar(param) {
    let { state, placeholder, filters = [], sorts, search = true, searchLabel, disabled = false, actions, mascot = false } = param;
    _s();
    const root = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(null);
    const [mascotHeight, setMascotHeight] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(0);
    const hasActions = Boolean(actions);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "CollectionToolbar.useEffect": ()=>{
            const node = root.current;
            if (!mascot || !node || !hasActions) return;
            const fields = node.querySelector('fieldset'), buttons = node.lastElementChild;
            const measure = {
                "CollectionToolbar.useEffect.measure": ()=>{
                    const form = fields.getBoundingClientRect(), actions = buttons.getBoundingClientRect();
                    // A wrapped action row has filters above it, rather than unused space.
                    const room = actions.left >= form.right ? Math.min(104, Math.floor(actions.top - form.top - 12)) : 0;
                    setMascotHeight(room >= 80 ? room : 0);
                }
            }["CollectionToolbar.useEffect.measure"];
            const observer = new ResizeObserver(measure);
            observer.observe(node);
            observer.observe(fields);
            observer.observe(buttons);
            measure();
            return ({
                "CollectionToolbar.useEffect": ()=>observer.disconnect()
            })["CollectionToolbar.useEffect"];
        }
    }["CollectionToolbar.useEffect"], [
        mascot,
        hasActions
    ]);
    const [expanded, setExpanded] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const primary = filters.length > 4 ? filters.slice(0, 3) : filters;
    const extra = filters.length > 4 ? filters.slice(3) : [];
    const extraCount = extra.filter((filter)=>state.values[filter.key]).length;
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "CollectionToolbar.useEffect": ()=>{
            if (extraCount) setExpanded(true);
        }
    }["CollectionToolbar.useEffect"], [
        extraCount
    ]);
    const field = (filter)=>{
        var _state_values_filter_key, _state_values_filter_key1, _state_values_filter_key2;
        return filter.source ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$RemoteFilterSelect$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["RemoteFilterSelect"], {
            source: filter.source,
            label: filter.label,
            value: (_state_values_filter_key = state.values[filter.key]) !== null && _state_values_filter_key !== void 0 ? _state_values_filter_key : '',
            onChange: (value)=>state.set(filter.key, value)
        }, filter.key, false, {
            fileName: "[project]/components/collections/CollectionToolbar.tsx",
            lineNumber: 32,
            columnNumber: 50
        }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("label", {
            className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].field,
            children: [
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                    children: filter.label
                }, void 0, false, {
                    fileName: "[project]/components/collections/CollectionToolbar.tsx",
                    lineNumber: 32,
                    columnNumber: 265
                }, this),
                filter.type ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Field$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Input"], {
                    type: filter.type,
                    "aria-label": filter.label,
                    value: String((_state_values_filter_key1 = state.values[filter.key]) !== null && _state_values_filter_key1 !== void 0 ? _state_values_filter_key1 : ''),
                    onChange: (event)=>state.set(filter.key, event.target.value)
                }, void 0, false, {
                    fileName: "[project]/components/collections/CollectionToolbar.tsx",
                    lineNumber: 32,
                    columnNumber: 305
                }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Field$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Select"], {
                    "aria-label": filter.label,
                    value: String((_state_values_filter_key2 = state.values[filter.key]) !== null && _state_values_filter_key2 !== void 0 ? _state_values_filter_key2 : ''),
                    onChange: (event)=>state.set(filter.key, event.target.value),
                    children: [
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("option", {
                            value: "",
                            children: "Tất cả"
                        }, void 0, false, {
                            fileName: "[project]/components/collections/CollectionToolbar.tsx",
                            lineNumber: 32,
                            columnNumber: 601
                        }, this),
                        filter.options.map((option)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("option", {
                                value: option.value,
                                children: option.label
                            }, option.value, false, {
                                fileName: "[project]/components/collections/CollectionToolbar.tsx",
                                lineNumber: 32,
                                columnNumber: 661
                            }, this))
                    ]
                }, void 0, true, {
                    fileName: "[project]/components/collections/CollectionToolbar.tsx",
                    lineNumber: 32,
                    columnNumber: 463
                }, this)
            ]
        }, filter.key, true, {
            fileName: "[project]/components/collections/CollectionToolbar.tsx",
            lineNumber: 32,
            columnNumber: 216
        }, this);
    };
    const fields = /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("fieldset", {
        disabled: disabled,
        className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].toolbar,
        role: "search",
        "aria-label": "Tìm kiếm và lọc danh sách",
        children: [
            search && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(SearchInput, {
                label: searchLabel !== null && searchLabel !== void 0 ? searchLabel : placeholder,
                placeholder: placeholder,
                value: state.values.q,
                onChange: (value)=>state.set('q', value)
            }, void 0, false, {
                fileName: "[project]/components/collections/CollectionToolbar.tsx",
                lineNumber: 34,
                columnNumber: 14
            }, this),
            primary.map(field),
            sorts && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("label", {
                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].field,
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        children: "Sắp xếp"
                    }, void 0, false, {
                        fileName: "[project]/components/collections/CollectionToolbar.tsx",
                        lineNumber: 36,
                        columnNumber: 45
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Field$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Select"], {
                        "aria-label": "Sắp xếp",
                        value: state.values.sort,
                        onChange: (event)=>state.set('sort', event.target.value),
                        children: sorts.map((option)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("option", {
                                value: option.value,
                                children: option.label
                            }, option.value, false, {
                                fileName: "[project]/components/collections/CollectionToolbar.tsx",
                                lineNumber: 36,
                                columnNumber: 194
                            }, this))
                    }, void 0, false, {
                        fileName: "[project]/components/collections/CollectionToolbar.tsx",
                        lineNumber: 36,
                        columnNumber: 65
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/components/collections/CollectionToolbar.tsx",
                lineNumber: 36,
                columnNumber: 13
            }, this),
            extra.length > 0 && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                variant: "outline",
                "aria-expanded": expanded,
                onClick: ()=>setExpanded((value)=>!value),
                children: [
                    "Thêm bộ lọc",
                    extraCount ? " (".concat(extraCount, ")") : ''
                ]
            }, void 0, true, {
                fileName: "[project]/components/collections/CollectionToolbar.tsx",
                lineNumber: 37,
                columnNumber: 22
            }, this),
            state.active && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                variant: "ghost",
                onClick: state.clear,
                children: "Xóa bộ lọc"
            }, void 0, false, {
                fileName: "[project]/components/collections/CollectionToolbar.tsx",
                lineNumber: 38,
                columnNumber: 20
            }, this),
            expanded && extra.length > 0 && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].extraFilters,
                children: extra.map(field)
            }, void 0, false, {
                fileName: "[project]/components/collections/CollectionToolbar.tsx",
                lineNumber: 39,
                columnNumber: 32
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/components/collections/CollectionToolbar.tsx",
        lineNumber: 33,
        columnNumber: 16
    }, this);
    return actions ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        ref: root,
        className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].toolbarWithActions,
        children: [
            fields,
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "".concat(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].actions, " ").concat(mascot ? __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].mascotActions : ''),
                children: [
                    mascot && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].toolbarMascot,
                        hidden: !mascotHeight,
                        style: {
                            height: mascotHeight
                        },
                        "aria-hidden": "true",
                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$brand$2f$ProctoOwlMascot$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ProctoOwlMascot"], {
                            variant: "peek",
                            direction: "left"
                        }, void 0, false, {
                            fileName: "[project]/components/collections/CollectionToolbar.tsx",
                            lineNumber: 42,
                            columnNumber: 125
                        }, this)
                    }, void 0, false, {
                        fileName: "[project]/components/collections/CollectionToolbar.tsx",
                        lineNumber: 42,
                        columnNumber: 14
                    }, this),
                    actions
                ]
            }, void 0, true, {
                fileName: "[project]/components/collections/CollectionToolbar.tsx",
                lineNumber: 41,
                columnNumber: 80
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/components/collections/CollectionToolbar.tsx",
        lineNumber: 41,
        columnNumber: 18
    }, this) : fields;
}
_s(CollectionToolbar, "6CArWoqa0Lx90M5RSgE9stYqvz4=");
_c1 = CollectionToolbar;
function CollectionPagination(param) {
    let { state, total, count, loading = false } = param;
    _s1();
    const page = Number(state.values.page), limit = Number(state.values.limit);
    const pages = Math.max(1, Math.ceil((total !== null && total !== void 0 ? total : count) / limit));
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "CollectionPagination.useEffect": ()=>{
            if (!loading && total !== null && page > pages) state.set('page', String(pages));
        }
    }["CollectionPagination.useEffect"], [
        loading,
        total,
        page,
        pages,
        state.set
    ]);
    const numbers = Array.from(new Set([
        1,
        pages,
        page - 1,
        page,
        page + 1
    ].filter((value)=>value >= 1 && value <= pages))).sort((a, b)=>a - b);
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].pagination,
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                role: "status",
                children: total === null ? "Đã tải ".concat(count, " kết quả") : "Hiển thị ".concat(count ? (page - 1) * limit + 1 : 0, "–").concat(count ? (page - 1) * limit + count : 0, " trên ").concat(total, " kết quả")
            }, void 0, false, {
                fileName: "[project]/components/collections/CollectionToolbar.tsx",
                lineNumber: 48,
                columnNumber: 45
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("label", {
                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].pageSize,
                children: [
                    "Mỗi trang",
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Field$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Select"], {
                        "aria-label": "Số kết quả mỗi trang",
                        value: state.values.limit,
                        onChange: (event)=>state.set('limit', event.target.value),
                        disabled: loading,
                        children: [
                            20,
                            50,
                            100
                        ].map((size)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("option", {
                                value: size,
                                children: size
                            }, size, false, {
                                fileName: "[project]/components/collections/CollectionToolbar.tsx",
                                lineNumber: 49,
                                columnNumber: 216
                            }, this))
                    }, void 0, false, {
                        fileName: "[project]/components/collections/CollectionToolbar.tsx",
                        lineNumber: 49,
                        columnNumber: 49
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/components/collections/CollectionToolbar.tsx",
                lineNumber: 49,
                columnNumber: 5
            }, this),
            total !== null && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("nav", {
                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].pages,
                "aria-label": "Phân trang",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                        variant: "outline",
                        disabled: loading || page <= 1,
                        "aria-label": "Trang trước",
                        onClick: ()=>state.set('page', String(page - 1)),
                        children: "‹"
                    }, void 0, false, {
                        fileName: "[project]/components/collections/CollectionToolbar.tsx",
                        lineNumber: 50,
                        columnNumber: 74
                    }, this),
                    numbers.map((number, index)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                            children: [
                                index > 0 && number - numbers[index - 1] > 1 && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    children: " … "
                                }, void 0, false, {
                                    fileName: "[project]/components/collections/CollectionToolbar.tsx",
                                    lineNumber: 50,
                                    columnNumber: 295
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                    variant: number === page ? 'primary' : 'outline',
                                    disabled: loading,
                                    "aria-label": "Trang ".concat(number),
                                    "aria-current": number === page ? 'page' : undefined,
                                    onClick: ()=>state.set('page', String(number)),
                                    children: number
                                }, void 0, false, {
                                    fileName: "[project]/components/collections/CollectionToolbar.tsx",
                                    lineNumber: 50,
                                    columnNumber: 312
                                }, this)
                            ]
                        }, number, true, {
                            fileName: "[project]/components/collections/CollectionToolbar.tsx",
                            lineNumber: 50,
                            columnNumber: 239
                        }, this)),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                        variant: "outline",
                        disabled: loading || page >= pages,
                        "aria-label": "Trang sau",
                        onClick: ()=>state.set('page', String(page + 1)),
                        children: "›"
                    }, void 0, false, {
                        fileName: "[project]/components/collections/CollectionToolbar.tsx",
                        lineNumber: 50,
                        columnNumber: 533
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/components/collections/CollectionToolbar.tsx",
                lineNumber: 50,
                columnNumber: 20
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/components/collections/CollectionToolbar.tsx",
        lineNumber: 48,
        columnNumber: 10
    }, this);
}
_s1(CollectionPagination, "OD7bBpZva5O2jO+Puf00hKivP7c=");
_c2 = CollectionPagination;
function EmptySearchState(param) {
    let { state, mascot = false } = param;
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Feedback$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["EmptyState"], {
        mascot: mascot,
        title: "Không tìm thấy kết quả phù hợp.",
        children: state.active && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
            variant: "outline",
            onClick: state.clear,
            children: "Xóa bộ lọc"
        }, void 0, false, {
            fileName: "[project]/components/collections/CollectionToolbar.tsx",
            lineNumber: 53,
            columnNumber: 187
        }, this)
    }, void 0, false, {
        fileName: "[project]/components/collections/CollectionToolbar.tsx",
        lineNumber: 53,
        columnNumber: 104
    }, this);
}
_c3 = EmptySearchState;
const commonSorts = [
    {
        value: 'newest',
        label: 'Mới nhất'
    },
    {
        value: 'oldest',
        label: 'Cũ nhất'
    },
    {
        value: 'name',
        label: 'Tên A–Z'
    }
];
var _c, _c1, _c2, _c3;
__turbopack_context__.k.register(_c, "SearchInput");
__turbopack_context__.k.register(_c1, "CollectionToolbar");
__turbopack_context__.k.register(_c2, "CollectionPagination");
__turbopack_context__.k.register(_c3, "EmptySearchState");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/components/student/StudentPageHeader.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "StudentPageHeader",
    ()=>StudentPageHeader
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
;
function StudentPageHeader(param) {
    let { title } = param;
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("h1", {
        className: "workspace-page-title",
        children: title
    }, void 0, false, {
        fileName: "[project]/components/student/StudentPageHeader.tsx",
        lineNumber: 2,
        columnNumber: 10
    }, this);
}
_c = StudentPageHeader;
var _c;
__turbopack_context__.k.register(_c, "StudentPageHeader");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/app/student/exams/page.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>StudentExamsPage
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/client/app-dir/link.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$index$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/components/ui/index.ts [app-client] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/ui/Button.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Card$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/ui/Card.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Feedback$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/ui/Feedback.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$auth$2f$AuthContext$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/auth/AuthContext.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$StudentExamCard$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/student/StudentExamCard.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$useStudentExamRefresh$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/student/useStudentExamRefresh.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/api.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$collections$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/lib/collections.ts [app-client] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$collection$2d$query$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/collection-query.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/collections/CollectionToolbar.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$studentExamStatus$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/studentExamStatus.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$StudentPageHeader$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/student/StudentPageHeader.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$calendar$2d$days$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__CalendarDays$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/calendar-days.mjs [app-client] (ecmascript) <export default as CalendarDays>");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$brand$2f$ProctoOwlMascot$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/brand/ProctoOwlMascot.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$StudentExams$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__ = __turbopack_context__.i("[project]/components/student/StudentExams.module.css [app-client] (css module)");
;
var _s = __turbopack_context__.k.signature();
'use client';
;
;
;
;
;
;
;
;
;
;
;
;
;
;
function StudentExamsPage() {
    _s();
    const { user } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$auth$2f$AuthContext$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useAuth"])(), collection = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$collections$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__["useCollectionState"])({
        period: ''
    });
    var _user_id;
    const { rows: exams, loading, error, reload } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$collections$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__["useServerCollection"])(collection, {
        "StudentExamsPage.useServerCollection": async (params)=>{
            // The student endpoint filters before returning all actionable exams. Old page/sort
            // URL parameters cannot hide an active attempt or change section priorities.
            const result = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$collection$2d$query$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["readCollection"])(await __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["api"].exams.list({
                ...params,
                actionable_only: true,
                period: undefined,
                page: undefined,
                limit: undefined,
                sort: 'newest'
            }));
            return {
                data: result.data
            };
        }
    }["StudentExamsPage.useServerCollection"], undefined, (_user_id = user === null || user === void 0 ? void 0 : user.id) !== null && _user_id !== void 0 ? _user_id : '');
    const now = (0, __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$useStudentExamRefresh$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useStudentExamRefresh"])(reload, user === null || user === void 0 ? void 0 : user.id);
    const grouped = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useMemo"])({
        "StudentExamsPage.useMemo[grouped]": ()=>{
            const groups = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$studentExamStatus$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["groupStudentActionableExams"])(exams, user === null || user === void 0 ? void 0 : user.id, now);
            if (collection.values.period) {
                for (const group of __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$studentExamStatus$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["actionableExamGroups"])groups[group] = groups[group].filter({
                    "StudentExamsPage.useMemo[grouped]": (item)=>item.state.status === collection.values.period
                }["StudentExamsPage.useMemo[grouped]"]);
            }
            return groups;
        }
    }["StudentExamsPage.useMemo[grouped]"], [
        exams,
        user === null || user === void 0 ? void 0 : user.id,
        now,
        collection.values.period
    ]);
    const count = __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$studentExamStatus$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["actionableExamGroups"].reduce((sum, group)=>sum + grouped[group].length, 0);
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "workspace-page student-exams-page ".concat(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$StudentExams$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].page),
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$StudentExams$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].hero,
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$StudentExams$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].eyebrow,
                                children: "Bài kiểm tra"
                            }, void 0, false, {
                                fileName: "[project]/app/student/exams/page.tsx",
                                lineNumber: 36,
                                columnNumber: 39
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$StudentPageHeader$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["StudentPageHeader"], {
                                title: "Làm kiểm tra"
                            }, void 0, false, {
                                fileName: "[project]/app/student/exams/page.tsx",
                                lineNumber: 36,
                                columnNumber: 85
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$StudentExams$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].description,
                                children: "Xem lịch thi, chuẩn bị thiết bị theo yêu cầu của đề và bắt đầu khi đến giờ."
                            }, void 0, false, {
                                fileName: "[project]/app/student/exams/page.tsx",
                                lineNumber: 36,
                                columnNumber: 126
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/app/student/exams/page.tsx",
                        lineNumber: 36,
                        columnNumber: 34
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$StudentExams$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].heroAside,
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$StudentExams$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].today,
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$calendar$2d$days$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__CalendarDays$3e$__["CalendarDays"], {
                                        size: 18,
                                        "aria-hidden": "true"
                                    }, void 0, false, {
                                        fileName: "[project]/app/student/exams/page.tsx",
                                        lineNumber: 36,
                                        columnNumber: 310
                                    }, this),
                                    new Intl.DateTimeFormat('vi-VN', {
                                        weekday: 'long',
                                        day: 'numeric',
                                        month: 'long',
                                        year: 'numeric'
                                    }).format(now)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/app/student/exams/page.tsx",
                                lineNumber: 36,
                                columnNumber: 279
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$brand$2f$ProctoOwlMascot$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ProctoOwlMascot"], {
                                variant: "compact",
                                size: "sm",
                                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$StudentExams$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].owl
                            }, void 0, false, {
                                fileName: "[project]/app/student/exams/page.tsx",
                                lineNumber: 36,
                                columnNumber: 466
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/app/student/exams/page.tsx",
                        lineNumber: 36,
                        columnNumber: 245
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/app/student/exams/page.tsx",
                lineNumber: 36,
                columnNumber: 5
            }, this),
            (collection.active || exams.length > 10) && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Card$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Card"], {
                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["CollectionToolbar"], {
                    state: collection,
                    placeholder: "Tìm đề thi...",
                    filters: [
                        {
                            key: 'period',
                            label: 'Trạng thái',
                            options: [
                                {
                                    value: 'in_progress',
                                    label: 'Đang làm'
                                },
                                {
                                    value: 'open',
                                    label: 'Đang diễn ra'
                                },
                                {
                                    value: 'upcoming',
                                    label: 'Sắp diễn ra'
                                }
                            ]
                        }
                    ]
                }, void 0, false, {
                    fileName: "[project]/app/student/exams/page.tsx",
                    lineNumber: 37,
                    columnNumber: 50
                }, this)
            }, void 0, false, {
                fileName: "[project]/app/student/exams/page.tsx",
                lineNumber: 37,
                columnNumber: 44
            }, this),
            loading && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Feedback$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["LoadingSkeleton"], {
                rows: 5
            }, void 0, false, {
                fileName: "[project]/app/student/exams/page.tsx",
                lineNumber: 38,
                columnNumber: 15
            }, this),
            error && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Card$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Card"], {
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                        role: "alert",
                        children: error
                    }, void 0, false, {
                        fileName: "[project]/app/student/exams/page.tsx",
                        lineNumber: 38,
                        columnNumber: 57
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                        variant: "warning",
                        onClick: ()=>void reload(),
                        children: "Thử lại"
                    }, void 0, false, {
                        fileName: "[project]/app/student/exams/page.tsx",
                        lineNumber: 38,
                        columnNumber: 84
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/app/student/exams/page.tsx",
                lineNumber: 38,
                columnNumber: 51
            }, this),
            !loading && !error && __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$studentExamStatus$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["actionableExamGroups"].map((group)=>grouped[group].length ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("section", {
                    className: "student-exam-section",
                    "data-exam-group": group,
                    children: [
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                            className: "student-exam-section-heading",
                            "data-chat-avoid": true,
                            children: [
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("h2", {
                                    children: {
                                        upcoming: 'Sắp diễn ra',
                                        current: 'Đang làm',
                                        open: 'Đang diễn ra'
                                    }[group]
                                }, void 0, false, {
                                    fileName: "[project]/app/student/exams/page.tsx",
                                    lineNumber: 39,
                                    columnNumber: 218
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    children: [
                                        grouped[group].length,
                                        " đề thi"
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/app/student/exams/page.tsx",
                                    lineNumber: 39,
                                    columnNumber: 299
                                }, this)
                            ]
                        }, void 0, true, {
                            fileName: "[project]/app/student/exams/page.tsx",
                            lineNumber: 39,
                            columnNumber: 156
                        }, this),
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                            className: "student-exam-grid",
                            children: grouped[group].map((param)=>{
                                let { exam, state } = param;
                                return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$StudentExamCard$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["StudentExamCard"], {
                                    exam: exam,
                                    state: state,
                                    playful: true
                                }, exam.id, false, {
                                    fileName: "[project]/app/student/exams/page.tsx",
                                    lineNumber: 39,
                                    columnNumber: 419
                                }, this);
                            })
                        }, void 0, false, {
                            fileName: "[project]/app/student/exams/page.tsx",
                            lineNumber: 39,
                            columnNumber: 348
                        }, this)
                    ]
                }, group, true, {
                    fileName: "[project]/app/student/exams/page.tsx",
                    lineNumber: 39,
                    columnNumber: 78
                }, this) : null),
            !loading && !error && !count && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Card$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Card"], {
                children: collection.active ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["EmptySearchState"], {
                    mascot: true,
                    state: collection
                }, void 0, false, {
                    fileName: "[project]/app/student/exams/page.tsx",
                    lineNumber: 40,
                    columnNumber: 57
                }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Feedback$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["EmptyState"], {
                    mascot: true,
                    title: "Hiện không có bài kiểm tra cần làm.",
                    children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"], {
                        className: "table-link",
                        href: "/student/grades",
                        children: "Xem điểm số / kết quả"
                    }, void 0, false, {
                        fileName: "[project]/app/student/exams/page.tsx",
                        lineNumber: 40,
                        columnNumber: 166
                    }, this)
                }, void 0, false, {
                    fileName: "[project]/app/student/exams/page.tsx",
                    lineNumber: 40,
                    columnNumber: 103
                }, this)
            }, void 0, false, {
                fileName: "[project]/app/student/exams/page.tsx",
                lineNumber: 40,
                columnNumber: 32
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/app/student/exams/page.tsx",
        lineNumber: 35,
        columnNumber: 10
    }, this);
}
_s(StudentExamsPage, "1Z+SmFjxrnmMbXZXE6mpddzUbfo=", false, function() {
    return [
        __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$auth$2f$AuthContext$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useAuth"],
        __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$collections$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__["useCollectionState"],
        __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$collections$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__["useServerCollection"],
        __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$useStudentExamRefresh$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useStudentExamRefresh"]
    ];
});
_c = StudentExamsPage;
var _c;
__turbopack_context__.k.register(_c, "StudentExamsPage");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
]);

//# sourceMappingURL=_48f35407._.js.map