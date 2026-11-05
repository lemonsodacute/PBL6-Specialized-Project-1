module.exports = [
"[project]/lib/uiErrors.ts [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "friendlyError",
    ()=>friendlyError
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$api$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/api.ts [app-ssr] (ecmascript)");
;
function friendlyError(cause, fallback = 'Không thể hoàn tất thao tác. Vui lòng thử lại.') {
    if (!(cause instanceof __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$api$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["ApiError"])) return cause instanceof TypeError ? 'Không thể kết nối đến máy chủ. Vui lòng thử lại.' : fallback;
    if (cause.status === 0 || cause.status === 408) return 'Không thể kết nối đến máy chủ. Vui lòng thử lại.';
    if (cause.status === 429) return 'Bạn đã thử quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.';
    if (cause.code === 'EMAIL_EXISTS') return 'Email này đã được sử dụng.';
    if (cause.code === 'STUDENT_ALREADY_ENROLLED' || cause.code === 'ALREADY_ENROLLED') return 'Sinh viên này đã thuộc lớp.';
    if (cause.code === 'ORAL_EXAMS_DISABLED') return 'Hình thức thi này đã ngừng hỗ trợ. Vui lòng dùng câu hỏi trắc nghiệm hoặc tự luận.';
    if (cause.code === 'INVALID_CREDENTIALS') return 'Email hoặc mật khẩu không chính xác.';
    if (cause.code === 'INVALID_RESET_TOKEN') return 'Mã đặt lại không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu mã mới.';
    if ([
        'ACCOUNT_DISABLED',
        'USER_INACTIVE',
        'ACCOUNT_INACTIVE'
    ].includes(cause.code ?? '')) return 'Tài khoản hiện không thể đăng nhập.';
    if (cause.status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
    if (cause.status === 403) return 'Bạn không có quyền thực hiện thao tác này.';
    if (cause.status === 422) return 'Thông tin chưa hợp lệ. Vui lòng kiểm tra các trường và thử lại.';
    return fallback;
}
}),
"[project]/lib/collections.ts [app-ssr] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useCollectionState",
    ()=>useCollectionState,
    "useServerCollection",
    ()=>useServerCollection
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$uiErrors$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/uiErrors.ts [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$collection$2d$query$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/collection-query.ts [app-ssr] (ecmascript)");
'use client';
;
;
;
;
function useCollectionState(defaultFilters = {}, defaultSort = 'newest', persist = true) {
    const defaults = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])({
        q: '',
        page: '1',
        limit: '20',
        sort: defaultSort,
        ...defaultFilters
    });
    const [values, setValues] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(defaults.current);
    const [ready, setReady] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(false);
    const [debounced, setDebounced] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])('');
    const currentValues = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(values);
    currentValues.current = values;
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        if (!persist) {
            setReady(true);
            return;
        }
        function read() {
            const query = new URLSearchParams(location.search);
            const next = {
                ...defaults.current
            };
            Object.keys(next).forEach((key)=>{
                if (query.has(key)) next[key] = query.get(key);
            });
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
        return ()=>window.removeEventListener('popstate', read);
    }, []);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        const timer = setTimeout(()=>setDebounced(values.q.trim()), 350);
        return ()=>clearTimeout(timer);
    }, [
        values.q
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        if (!ready || !persist) return;
        const query = new URLSearchParams(location.search);
        Object.keys(defaults.current).forEach((key)=>{
            const raw = values[key];
            const value = key === 'q' ? raw.trim() : raw;
            if (!value || value === defaults.current[key]) query.delete(key);
            else query.set(key, value);
        });
        const target = location.pathname + (query.size ? '?' + query.toString() : '') + location.hash;
        if (target !== location.pathname + location.search + location.hash) window.history.replaceState(window.history.state, '', target);
    }, [
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
    const params = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useMemo"])(()=>JSON.parse(serialized), [
        serialized
    ]);
    const set = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])((key, value)=>{
        // A filter/page action applies the current search immediately. Otherwise
        // the request can combine new filters with the previous debounced query.
        if (key !== 'q') setDebounced(currentValues.current.q.trim());
        setValues((current)=>({
                ...current,
                [key]: value,
                ...key === 'page' ? {} : {
                    page: '1'
                }
            }));
    }, []);
    const clear = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])(()=>{
        setValues({
            ...defaults.current
        });
        setDebounced('');
    }, []);
    const active = Object.entries(defaults.current).some(([key, value])=>![
            'page',
            'limit',
            'sort'
        ].includes(key) && (key === 'q' ? values.q.trim() : values[key]) !== value);
    return {
        values,
        params,
        ready,
        set,
        clear,
        active,
        pending: values.q.trim() !== debounced,
        key: (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$collection$2d$query$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["listQuery"])(params)
    };
}
function useServerCollection(state, loader, message = 'Không tải được danh sách. Vui lòng thử lại.', scope = '') {
    const [rows, setRows] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])([]);
    const [meta, setMeta] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])();
    const [loading, setLoading] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(true);
    const [error, setError] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])('');
    const request = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(0);
    const latest = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])({
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
    const reload = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])(async (background = false)=>{
        const version = ++request.current;
        if (!background) {
            setLoading(true);
            setRows([]);
        }
        setError('');
        try {
            const result = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$collection$2d$query$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["readCollection"])(await latest.current.loader(latest.current.params));
            if (version === request.current) {
                const lastPage = result.meta?.total !== undefined ? Math.max(1, Math.ceil(result.meta.total / Number(latest.current.params.limit ?? 20))) : null;
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
                setError((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$uiErrors$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["friendlyError"])(cause, latest.current.message));
                setMeta(undefined);
            }
        } finally{
            if (version === request.current) setLoading(false);
        }
    }, []);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        if (state.ready) void reload();
        return ()=>{
            request.current++;
        };
    }, [
        state.key,
        state.ready,
        reload,
        scope
    ]);
    return {
        rows,
        meta,
        total: meta?.total ?? null,
        loading: loading || state.pending,
        error,
        reload
    };
}
}),
"[project]/components/collections/CollectionToolbar.module.css [app-ssr] (css module)", ((__turbopack_context__) => {

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
"[project]/components/collections/RemoteFilterSelect.tsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "RemoteFilterSelect",
    ()=>RemoteFilterSelect
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$search$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__Search$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/search.mjs [app-ssr] (ecmascript) <export default as Search>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$api$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/api.ts [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$collection$2d$query$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/collection-query.ts [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$index$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/components/ui/index.ts [app-ssr] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Field$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/ui/Field.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Button$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/ui/Button.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__ = __turbopack_context__.i("[project]/components/collections/CollectionToolbar.module.css [app-ssr] (css module)");
'use client';
;
;
;
;
;
;
;
;
const label = (item)=>item.name ?? item.title ?? [
        item.full_name,
        item.student_code ?? item.email
    ].filter(Boolean).join(' · ');
function RemoteFilterSelect({ source, label: heading, value, onChange, classId, refreshKey = 0, disabled = false }) {
    const [query, setQuery] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])('');
    const [items, setItems] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])([]);
    const [selected, setSelected] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(null);
    const [error, setError] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(false);
    const [retry, setRetry] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(0);
    const [loadedScope, setLoadedScope] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(''), [selectedScope, setSelectedScope] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])('');
    const selectionScope = `${source}|${classId ?? ''}|${refreshKey}`;
    const scope = `${selectionScope}|${query.trim()}|${retry}`;
    const loading = loadedScope !== scope, visibleItems = loading ? [] : items;
    const [searchOpen, setSearchOpen] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(false);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        let active = true;
        const timer = setTimeout(async ()=>{
            try {
                const params = {
                    q: query.trim(),
                    page: 1,
                    limit: 20,
                    sort: 'name'
                };
                const response = source === 'classes' ? await __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$api$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["api"].classes.list(params) : source === 'exams' ? await __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$api$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["api"].exams.list(params) : source === 'teachers' ? await __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$api$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["api"].users.list({
                    ...params,
                    role: 'teacher'
                }) : classId ? await __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$api$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["api"].classes.availableStudents(classId, params) : null;
                if (active) {
                    setItems((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$collection$2d$query$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["readCollection"])(response).data);
                    setError(false);
                    setLoadedScope(scope);
                }
            } catch  {
                if (active) {
                    setItems([]);
                    setError(true);
                    setLoadedScope(scope);
                }
            }
        }, 350);
        return ()=>{
            active = false;
            clearTimeout(timer);
        };
    }, [
        query,
        source,
        classId,
        retry,
        refreshKey,
        scope
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        if (!value) {
            setSelected(null);
            return;
        }
        let active = true;
        const found = loadedScope === scope ? items.find((item)=>item.id === value) : null;
        if (found) {
            setSelected(found);
            setSelectedScope(selectionScope);
            return;
        }
        if (source === 'students') {
            setSelected((current)=>current?.id === value ? current : null);
            return;
        }
        (async ()=>{
            try {
                const response = source === 'classes' ? await __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$api$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["api"].classes.get(value, {
                    include_students: false
                }) : source === 'teachers' ? await __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$api$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["api"].users.get(value) : await __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$api$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["api"].exams.list({
                    exam_id: value,
                    page: 1,
                    limit: 20
                });
                const option = source === 'exams' ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$collection$2d$query$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["readCollection"])(response).data[0] : response.data;
                if (active) {
                    setSelected(option ?? null);
                    setSelectedScope(selectionScope);
                }
            } catch  {
                if (active) setSelected(null);
            }
        })();
        return ()=>{
            active = false;
        };
    }, [
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
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__["default"].field,
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                children: heading
            }, void 0, false, {
                fileName: "[project]/components/collections/RemoteFilterSelect.tsx",
                lineNumber: 42,
                columnNumber: 40
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__["default"].lookupControl,
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Field$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Select"], {
                        "aria-label": heading,
                        value: value,
                        disabled: disabled || loading || empty || error,
                        "aria-busy": loading || undefined,
                        onChange: (event)=>onChange(event.target.value),
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("option", {
                                value: "",
                                children: placeholder
                            }, void 0, false, {
                                fileName: "[project]/components/collections/RemoteFilterSelect.tsx",
                                lineNumber: 43,
                                columnNumber: 169
                            }, this),
                            value && !options.some((item)=>item.id === value) && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("option", {
                                value: value,
                                disabled: true,
                                children: "Lựa chọn không còn khả dụng"
                            }, void 0, false, {
                                fileName: "[project]/components/collections/RemoteFilterSelect.tsx",
                                lineNumber: 43,
                                columnNumber: 254
                            }, this),
                            options.map((item)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("option", {
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
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Button$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["IconButton"], {
                        label: `Tìm ${heading.toLowerCase()}`,
                        disabled: disabled,
                        "aria-expanded": searchOpen,
                        onClick: ()=>setSearchOpen((value)=>!value),
                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$search$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__Search$3e$__["Search"], {
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
            (searchOpen || query) && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Field$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Input"], {
                autoFocus: true,
                disabled: disabled,
                type: "search",
                "aria-label": `Tìm ${heading.toLowerCase()}`,
                placeholder: `Tìm ${heading.toLowerCase()}...`,
                value: query,
                onChange: (event)=>setQuery(event.target.value)
            }, void 0, false, {
                fileName: "[project]/components/collections/RemoteFilterSelect.tsx",
                lineNumber: 45,
                columnNumber: 27
            }, this),
            empty && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                role: "status",
                children: query.trim() ? 'Không tìm thấy sinh viên phù hợp.' : 'Không còn sinh viên để thêm.'
            }, void 0, false, {
                fileName: "[project]/components/collections/RemoteFilterSelect.tsx",
                lineNumber: 46,
                columnNumber: 13
            }, this),
            !loading && error && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                role: "alert",
                children: [
                    "Không tải được lựa chọn. ",
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Button$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Button"], {
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
}),
"[project]/components/collections/CollectionToolbar.tsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
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
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$search$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__Search$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/search.mjs [app-ssr] (ecmascript) <export default as Search>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$x$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__X$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/x.mjs [app-ssr] (ecmascript) <export default as X>");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$index$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/components/ui/index.ts [app-ssr] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Button$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/ui/Button.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Field$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/ui/Field.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Feedback$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/ui/Feedback.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__ = __turbopack_context__.i("[project]/components/collections/CollectionToolbar.module.css [app-ssr] (css module)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$RemoteFilterSelect$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/collections/RemoteFilterSelect.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$brand$2f$ProctoOwlMascot$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/brand/ProctoOwlMascot.tsx [app-ssr] (ecmascript)");
'use client';
;
;
;
;
;
;
;
function SearchInput({ label, placeholder, value, onChange }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("label", {
        className: `${__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__["default"].field} ${__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__["default"].searchField}`,
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                children: label
            }, void 0, false, {
                fileName: "[project]/components/collections/CollectionToolbar.tsx",
                lineNumber: 13,
                columnNumber: 69
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__["default"].search,
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$search$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__Search$3e$__["Search"], {
                        size: 18,
                        "aria-hidden": "true"
                    }, void 0, false, {
                        fileName: "[project]/components/collections/CollectionToolbar.tsx",
                        lineNumber: 13,
                        columnNumber: 120
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Field$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Input"], {
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
                    value && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                        className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__["default"].clearSearch,
                        type: "button",
                        "aria-label": "Xóa từ khóa tìm kiếm",
                        onClick: ()=>onChange(''),
                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$x$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__X$3e$__["X"], {
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
function CollectionToolbar({ state, placeholder, filters = [], sorts, search = true, searchLabel, disabled = false, actions, mascot = false }) {
    const root = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const [mascotHeight, setMascotHeight] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(0);
    const hasActions = Boolean(actions);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        const node = root.current;
        if (!mascot || !node || !hasActions) return;
        const fields = node.querySelector('fieldset'), buttons = node.lastElementChild;
        const measure = ()=>{
            const form = fields.getBoundingClientRect(), actions = buttons.getBoundingClientRect();
            // A wrapped action row has filters above it, rather than unused space.
            const room = actions.left >= form.right ? Math.min(104, Math.floor(actions.top - form.top - 12)) : 0;
            setMascotHeight(room >= 80 ? room : 0);
        };
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        observer.observe(fields);
        observer.observe(buttons);
        measure();
        return ()=>observer.disconnect();
    }, [
        mascot,
        hasActions
    ]);
    const [expanded, setExpanded] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(false);
    const primary = filters.length > 4 ? filters.slice(0, 3) : filters;
    const extra = filters.length > 4 ? filters.slice(3) : [];
    const extraCount = extra.filter((filter)=>state.values[filter.key]).length;
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        if (extraCount) setExpanded(true);
    }, [
        extraCount
    ]);
    const field = (filter)=>filter.source ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$RemoteFilterSelect$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["RemoteFilterSelect"], {
            source: filter.source,
            label: filter.label,
            value: state.values[filter.key] ?? '',
            onChange: (value)=>state.set(filter.key, value)
        }, filter.key, false, {
            fileName: "[project]/components/collections/CollectionToolbar.tsx",
            lineNumber: 32,
            columnNumber: 50
        }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("label", {
            className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__["default"].field,
            children: [
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                    children: filter.label
                }, void 0, false, {
                    fileName: "[project]/components/collections/CollectionToolbar.tsx",
                    lineNumber: 32,
                    columnNumber: 265
                }, this),
                filter.type ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Field$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Input"], {
                    type: filter.type,
                    "aria-label": filter.label,
                    value: String(state.values[filter.key] ?? ''),
                    onChange: (event)=>state.set(filter.key, event.target.value)
                }, void 0, false, {
                    fileName: "[project]/components/collections/CollectionToolbar.tsx",
                    lineNumber: 32,
                    columnNumber: 305
                }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Field$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Select"], {
                    "aria-label": filter.label,
                    value: String(state.values[filter.key] ?? ''),
                    onChange: (event)=>state.set(filter.key, event.target.value),
                    children: [
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("option", {
                            value: "",
                            children: "Tất cả"
                        }, void 0, false, {
                            fileName: "[project]/components/collections/CollectionToolbar.tsx",
                            lineNumber: 32,
                            columnNumber: 601
                        }, this),
                        filter.options.map((option)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("option", {
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
    const fields = /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("fieldset", {
        disabled: disabled,
        className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__["default"].toolbar,
        role: "search",
        "aria-label": "Tìm kiếm và lọc danh sách",
        children: [
            search && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(SearchInput, {
                label: searchLabel ?? placeholder,
                placeholder: placeholder,
                value: state.values.q,
                onChange: (value)=>state.set('q', value)
            }, void 0, false, {
                fileName: "[project]/components/collections/CollectionToolbar.tsx",
                lineNumber: 34,
                columnNumber: 14
            }, this),
            primary.map(field),
            sorts && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("label", {
                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__["default"].field,
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        children: "Sắp xếp"
                    }, void 0, false, {
                        fileName: "[project]/components/collections/CollectionToolbar.tsx",
                        lineNumber: 36,
                        columnNumber: 45
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Field$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Select"], {
                        "aria-label": "Sắp xếp",
                        value: state.values.sort,
                        onChange: (event)=>state.set('sort', event.target.value),
                        children: sorts.map((option)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("option", {
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
            extra.length > 0 && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Button$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Button"], {
                variant: "outline",
                "aria-expanded": expanded,
                onClick: ()=>setExpanded((value)=>!value),
                children: [
                    "Thêm bộ lọc",
                    extraCount ? ` (${extraCount})` : ''
                ]
            }, void 0, true, {
                fileName: "[project]/components/collections/CollectionToolbar.tsx",
                lineNumber: 37,
                columnNumber: 22
            }, this),
            state.active && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Button$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Button"], {
                variant: "ghost",
                onClick: state.clear,
                children: "Xóa bộ lọc"
            }, void 0, false, {
                fileName: "[project]/components/collections/CollectionToolbar.tsx",
                lineNumber: 38,
                columnNumber: 20
            }, this),
            expanded && extra.length > 0 && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__["default"].extraFilters,
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
    return actions ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        ref: root,
        className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__["default"].toolbarWithActions,
        children: [
            fields,
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: `${__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__["default"].actions} ${mascot ? __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__["default"].mascotActions : ''}`,
                children: [
                    mascot && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__["default"].toolbarMascot,
                        hidden: !mascotHeight,
                        style: {
                            height: mascotHeight
                        },
                        "aria-hidden": "true",
                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$brand$2f$ProctoOwlMascot$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["ProctoOwlMascot"], {
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
function CollectionPagination({ state, total, count, loading = false }) {
    const page = Number(state.values.page), limit = Number(state.values.limit);
    const pages = Math.max(1, Math.ceil((total ?? count) / limit));
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        if (!loading && total !== null && page > pages) state.set('page', String(pages));
    }, [
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
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__["default"].pagination,
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                role: "status",
                children: total === null ? `Đã tải ${count} kết quả` : `Hiển thị ${count ? (page - 1) * limit + 1 : 0}–${count ? (page - 1) * limit + count : 0} trên ${total} kết quả`
            }, void 0, false, {
                fileName: "[project]/components/collections/CollectionToolbar.tsx",
                lineNumber: 48,
                columnNumber: 45
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("label", {
                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__["default"].pageSize,
                children: [
                    "Mỗi trang",
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Field$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Select"], {
                        "aria-label": "Số kết quả mỗi trang",
                        value: state.values.limit,
                        onChange: (event)=>state.set('limit', event.target.value),
                        disabled: loading,
                        children: [
                            20,
                            50,
                            100
                        ].map((size)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("option", {
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
            total !== null && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("nav", {
                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__["default"].pages,
                "aria-label": "Phân trang",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Button$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Button"], {
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
                    numbers.map((number, index)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                            children: [
                                index > 0 && number - numbers[index - 1] > 1 && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    children: " … "
                                }, void 0, false, {
                                    fileName: "[project]/components/collections/CollectionToolbar.tsx",
                                    lineNumber: 50,
                                    columnNumber: 295
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Button$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Button"], {
                                    variant: number === page ? 'primary' : 'outline',
                                    disabled: loading,
                                    "aria-label": `Trang ${number}`,
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
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Button$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Button"], {
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
function EmptySearchState({ state, mascot = false }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Feedback$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["EmptyState"], {
        mascot: mascot,
        title: "Không tìm thấy kết quả phù hợp.",
        children: state.active && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Button$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Button"], {
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
}),
"[project]/lib/teacher-results.ts [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "answerText",
    ()=>answerText,
    "exportResults",
    ()=>exportResults,
    "isSubmitted",
    ()=>isSubmitted,
    "resultDate",
    ()=>resultDate,
    "resultError",
    ()=>resultError,
    "resultStatusLabels",
    ()=>resultStatusLabels,
    "scoreText",
    ()=>scoreText
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$api$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/api.ts [app-ssr] (ecmascript)");
;
const resultStatusLabels = {
    not_started: 'Chưa làm',
    in_progress: 'Đang làm',
    submitted: 'Đã nộp',
    auto_submitted: 'Đã nộp tự động',
    terminated: 'Bị kết thúc'
};
function isSubmitted(status) {
    return [
        'submitted',
        'auto_submitted',
        'terminated'
    ].includes(status);
}
function scoreText(value) {
    return value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : new Intl.NumberFormat('vi-VN', {
        maximumFractionDigits: 2
    }).format(Number(value));
}
function resultDate(value) {
    return value && Number.isFinite(new Date(value).getTime()) ? new Intl.DateTimeFormat('vi-VN', {
        dateStyle: 'short',
        timeStyle: 'short'
    }).format(new Date(value)) : '—';
}
function resultError(cause) {
    if (cause instanceof __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$api$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["ApiError"]) {
        if (cause.status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
        if (cause.status === 403) return 'Bạn không có quyền xem kết quả đề thi này.';
        if (cause.status === 404) return 'Không tìm thấy đề thi hoặc bài làm.';
        if (cause.status === 409) return 'Bài làm chưa được nộp. Vui lòng tải lại kết quả sau khi sinh viên nộp bài.';
    }
    return 'Không tải được kết quả. Vui lòng thử lại.';
}
function answerText(value, options) {
    if (value === null || value === undefined) return 'Chưa trả lời';
    const wrapped = options && typeof options === 'object' && 'options' in options ? options.options : options;
    const rows = Array.isArray(wrapped) ? wrapped : [];
    const label = (id)=>{
        const row = rows.find((option)=>option && typeof option === 'object' && String(option.id) === String(id));
        return row ? String(row.text ?? row.content ?? row.label ?? id) : String(id);
    };
    if (Array.isArray(value)) return value.length ? value.map(label).join('; ') : 'Chưa trả lời';
    if (typeof value === 'object') {
        const record = value;
        for (const key of [
            'selected_option_id',
            'selected_option',
            'correct_option_id',
            'correct_option',
            'selected_option_ids',
            'selected_options',
            'correct_option_ids',
            'correct_options',
            'answer',
            'answers',
            'text'
        ]){
            if (key in record) return answerText(record[key], options);
        }
        return JSON.stringify(value);
    }
    return label(value);
}
function exportResults(report) {
    const cell = (value)=>{
        let text = String(value ?? '');
        if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
        return `"${text.replace(/"/g, '""')}"`;
    };
    const lines = [
        [
            'MSSV',
            'Họ tên',
            'Trạng thái',
            'Lần thi',
            'Số câu đúng',
            'Điểm',
            'Điểm tối đa',
            'Nộp lúc'
        ]
    ];
    for (const row of report.results){
        // Export all attempts rather than silently dropping previous submissions.
        for (const attempt of row.attempts.length ? row.attempts : [
            row
        ])lines.push([
            row.student_code,
            row.full_name,
            resultStatusLabels[attempt.status],
            attempt.attempt_number,
            attempt.correct_count,
            attempt.score,
            attempt.max_score,
            attempt.submitted_at
        ]);
    }
    const url = URL.createObjectURL(new Blob([
        '\uFEFF' + lines.map((line)=>line.map(cell).join(',')).join('\r\n')
    ], {
        type: 'text/csv;charset=utf-8;'
    }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `ket-qua-${report.exam.id}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url), 1000);
}
}),
"[project]/components/student/useStudentExamRefresh.ts [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useStudentExamRefresh",
    ()=>useStudentExamRefresh
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)");
'use client';
;
function useStudentExamRefresh(reload, studentId) {
    const [now, setNow] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(Date.now());
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        if (!studentId) return;
        const refresh = ()=>{
            if (document.visibilityState === 'visible') void reload(true);
        };
        const submitted = (event)=>{
            const detail = event.detail;
            if (!detail?.studentId || detail.studentId === studentId) refresh();
        };
        const clock = window.setInterval(()=>setNow(Date.now()), 1000), poll = window.setInterval(refresh, 15_000);
        window.addEventListener('focus', refresh);
        document.addEventListener('visibilitychange', refresh);
        window.addEventListener('student-exam-updated', submitted);
        return ()=>{
            window.clearInterval(clock);
            window.clearInterval(poll);
            window.removeEventListener('focus', refresh);
            document.removeEventListener('visibilitychange', refresh);
            window.removeEventListener('student-exam-updated', submitted);
        };
    }, [
        reload,
        studentId
    ]);
    return now;
}
}),
"[project]/components/student/StudentPageHeader.tsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "StudentPageHeader",
    ()=>StudentPageHeader
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
;
function StudentPageHeader({ title }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("h1", {
        className: "workspace-page-title",
        children: title
    }, void 0, false, {
        fileName: "[project]/components/student/StudentPageHeader.tsx",
        lineNumber: 2,
        columnNumber: 10
    }, this);
}
}),
"[project]/components/student/AttemptCollection.module.css [app-ssr] (css module)", ((__turbopack_context__) => {

__turbopack_context__.v({
  "attemptNumber": "AttemptCollection-module__Iwu-0W__attemptNumber",
  "duration": "AttemptCollection-module__Iwu-0W__duration",
  "exam": "AttemptCollection-module__Iwu-0W__exam",
  "filters": "AttemptCollection-module__Iwu-0W__filters",
  "history": "AttemptCollection-module__Iwu-0W__history",
  "page": "AttemptCollection-module__Iwu-0W__page",
  "pendingScore": "AttemptCollection-module__Iwu-0W__pendingScore",
  "resultLink": "AttemptCollection-module__Iwu-0W__resultLink",
  "results": "AttemptCollection-module__Iwu-0W__results",
  "score": "AttemptCollection-module__Iwu-0W__score",
  "submittedTime": "AttemptCollection-module__Iwu-0W__submittedTime",
});
}),
"[project]/components/student/AttemptCollection.tsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "AttemptCollection",
    ()=>AttemptCollection
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Border$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/ui/Border.ts [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/client/app-dir/link.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$arrow$2d$right$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__ArrowRight$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/arrow-right.mjs [app-ssr] (ecmascript) <export default as ArrowRight>");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$auth$2f$AuthContext$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/auth/AuthContext.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$api$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/api.ts [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$collections$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/lib/collections.ts [app-ssr] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$index$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/components/ui/index.ts [app-ssr] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Badge$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/ui/Badge.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Button$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/ui/Button.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Card$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/ui/Card.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Feedback$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/ui/Feedback.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Table$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/ui/Table.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/collections/CollectionToolbar.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$teacher$2d$results$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/teacher-results.ts [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$studentExamStatus$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/studentExamStatus.ts [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$useStudentExamRefresh$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/student/useStudentExamRefresh.ts [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$StudentPageHeader$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/student/StudentPageHeader.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$AttemptCollection$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__ = __turbopack_context__.i("[project]/components/student/AttemptCollection.module.css [app-ssr] (css module)");
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
function AttemptTime({ value }) {
    if (!value || !Number.isFinite(Date.parse(value))) return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Fragment"], {
        children: "—"
    }, void 0, false);
    const date = new Date(value), timeZone = 'Asia/Ho_Chi_Minh';
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("time", {
        className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$AttemptCollection$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__["default"].submittedTime,
        dateTime: value,
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                children: new Intl.DateTimeFormat('vi-VN', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    timeZone
                }).format(date)
            }, void 0, false, {
                fileName: "[project]/components/student/AttemptCollection.tsx",
                lineNumber: 22,
                columnNumber: 5
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("small", {
                children: new Intl.DateTimeFormat('vi-VN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone
                }).format(date)
            }, void 0, false, {
                fileName: "[project]/components/student/AttemptCollection.tsx",
                lineNumber: 23,
                columnNumber: 5
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/components/student/AttemptCollection.tsx",
        lineNumber: 21,
        columnNumber: 10
    }, this);
}
function durationText(row, now) {
    const start = Date.parse(row.started_at ?? '');
    const end = row.submitted_at ? Date.parse(row.submitted_at) : row.status.toLowerCase() === 'in_progress' ? now : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return '—';
    const seconds = Math.max(0, Math.floor((end - start) / 1000));
    return `${Math.floor(seconds / 60)} phút ${seconds % 60} giây`;
}
function AttemptCollection({ history = false }) {
    const { user } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$auth$2f$AuthContext$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useAuth"])();
    const state = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$collections$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$locals$3e$__["useCollectionState"])({
        status: '',
        from_time: '',
        to_time: ''
    }, history ? 'started' : 'submitted');
    const result = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$collections$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$locals$3e$__["useServerCollection"])(state, (params)=>__TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$api$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["api"].attempts.mine({
            ...params,
            completed_only: !history,
            time_field: history ? 'started' : 'submitted',
            from_time: params.from_time ? new Date(String(params.from_time) + 'T00:00:00+07:00').toISOString() : undefined,
            to_time: params.to_time ? new Date(String(params.to_time) + 'T23:59:59.999+07:00').toISOString() : undefined
        }), undefined, user?.id ?? '');
    const now = (0, __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$useStudentExamRefresh$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useStudentExamRefresh"])(result.reload, user?.id);
    const rows = history ? result.rows : result.rows.filter((row)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$studentExamStatus$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["isCompletedAttempt"])(row.status));
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: `workspace-page ${__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$AttemptCollection$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__["default"].page} ${history ? __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$AttemptCollection$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__["default"].history : ''}`,
        children: [
            !history && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Fragment"], {
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$StudentPageHeader$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["StudentPageHeader"], {
                        title: "Điểm số / Kết quả"
                    }, void 0, false, {
                        fileName: "[project]/components/student/AttemptCollection.tsx",
                        lineNumber: 45,
                        columnNumber: 7
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                        children: "Các bài đã hoàn thành và điểm chính thức. Bài chưa chấm xong sẽ hiển thị đang chờ chấm."
                    }, void 0, false, {
                        fileName: "[project]/components/student/AttemptCollection.tsx",
                        lineNumber: 46,
                        columnNumber: 7
                    }, this)
                ]
            }, void 0, true),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Card$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Card"], {
                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$AttemptCollection$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__["default"].filters,
                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["CollectionToolbar"], {
                    state: state,
                    searchLabel: "Tìm đề thi",
                    placeholder: "Nhập tên đề thi...",
                    filters: [
                        {
                            key: 'status',
                            label: 'Trạng thái',
                            options: [
                                ...history ? [
                                    {
                                        value: 'not_started',
                                        label: 'Chưa bắt đầu'
                                    },
                                    {
                                        value: 'in_progress',
                                        label: 'Đang làm'
                                    }
                                ] : [],
                                {
                                    value: 'submitted',
                                    label: 'Đã nộp'
                                },
                                {
                                    value: 'auto_submitted',
                                    label: 'Tự động nộp'
                                },
                                {
                                    value: 'terminated',
                                    label: 'Bị kết thúc'
                                }
                            ]
                        },
                        {
                            key: 'from_time',
                            label: history ? 'Bắt đầu từ ngày' : 'Nộp từ ngày',
                            type: 'date',
                            options: []
                        },
                        {
                            key: 'to_time',
                            label: history ? 'Bắt đầu đến ngày' : 'Nộp đến ngày',
                            type: 'date',
                            options: []
                        }
                    ],
                    sorts: history ? [
                        {
                            value: 'started',
                            label: 'Bắt đầu gần nhất'
                        },
                        {
                            value: 'oldest',
                            label: 'Cũ nhất'
                        }
                    ] : [
                        {
                            value: 'submitted',
                            label: 'Nộp gần nhất'
                        },
                        {
                            value: 'oldest',
                            label: 'Cũ nhất'
                        }
                    ]
                }, void 0, false, {
                    fileName: "[project]/components/student/AttemptCollection.tsx",
                    lineNumber: 48,
                    columnNumber: 38
                }, this)
            }, void 0, false, {
                fileName: "[project]/components/student/AttemptCollection.tsx",
                lineNumber: 48,
                columnNumber: 5
            }, this),
            result.error && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Card$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Card"], {
                role: "alert",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                        children: result.error
                    }, void 0, false, {
                        fileName: "[project]/components/student/AttemptCollection.tsx",
                        lineNumber: 53,
                        columnNumber: 39
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Button$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Button"], {
                        onClick: ()=>void result.reload(),
                        children: "Thử lại"
                    }, void 0, false, {
                        fileName: "[project]/components/student/AttemptCollection.tsx",
                        lineNumber: 53,
                        columnNumber: 60
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/components/student/AttemptCollection.tsx",
                lineNumber: 53,
                columnNumber: 20
            }, this),
            result.loading ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Feedback$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["LoadingSkeleton"], {
                rows: 4
            }, void 0, false, {
                fileName: "[project]/components/student/AttemptCollection.tsx",
                lineNumber: 54,
                columnNumber: 21
            }, this) : !result.error && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Card$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Card"], {
                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$AttemptCollection$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__["default"].results,
                "data-chat-avoid": true,
                children: [
                    rows.length ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Table$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Table"], {
                        label: history ? 'Lịch sử làm bài' : 'Điểm số / Kết quả',
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("thead", {
                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("tr", {
                                    children: [
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("th", {
                                            children: "Đề thi"
                                        }, void 0, false, {
                                            fileName: "[project]/components/student/AttemptCollection.tsx",
                                            lineNumber: 55,
                                            columnNumber: 18
                                        }, this),
                                        history ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Fragment"], {
                                            children: [
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("th", {
                                                    children: "Lần làm"
                                                }, void 0, false, {
                                                    fileName: "[project]/components/student/AttemptCollection.tsx",
                                                    lineNumber: 55,
                                                    columnNumber: 44
                                                }, this),
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("th", {
                                                    children: "Bắt đầu lúc"
                                                }, void 0, false, {
                                                    fileName: "[project]/components/student/AttemptCollection.tsx",
                                                    lineNumber: 55,
                                                    columnNumber: 60
                                                }, this),
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("th", {
                                                    children: "Nộp lúc"
                                                }, void 0, false, {
                                                    fileName: "[project]/components/student/AttemptCollection.tsx",
                                                    lineNumber: 55,
                                                    columnNumber: 80
                                                }, this),
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("th", {
                                                    children: "Thời lượng"
                                                }, void 0, false, {
                                                    fileName: "[project]/components/student/AttemptCollection.tsx",
                                                    lineNumber: 55,
                                                    columnNumber: 96
                                                }, this)
                                            ]
                                        }, void 0, true) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("th", {
                                            children: "Điểm"
                                        }, void 0, false, {
                                            fileName: "[project]/components/student/AttemptCollection.tsx",
                                            lineNumber: 55,
                                            columnNumber: 119
                                        }, this),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("th", {
                                            children: "Trạng thái"
                                        }, void 0, false, {
                                            fileName: "[project]/components/student/AttemptCollection.tsx",
                                            lineNumber: 55,
                                            columnNumber: 133
                                        }, this),
                                        !history && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("th", {
                                            children: "Nộp lúc"
                                        }, void 0, false, {
                                            fileName: "[project]/components/student/AttemptCollection.tsx",
                                            lineNumber: 55,
                                            columnNumber: 163
                                        }, this),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("th", {
                                            children: "Thao tác"
                                        }, void 0, false, {
                                            fileName: "[project]/components/student/AttemptCollection.tsx",
                                            lineNumber: 55,
                                            columnNumber: 180
                                        }, this)
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/components/student/AttemptCollection.tsx",
                                    lineNumber: 55,
                                    columnNumber: 14
                                }, this)
                            }, void 0, false, {
                                fileName: "[project]/components/student/AttemptCollection.tsx",
                                lineNumber: 55,
                                columnNumber: 7
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("tbody", {
                                children: rows.map((row)=>{
                                    const score = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$studentExamStatus$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["getStudentFinalScore"])(row), completed = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$studentExamStatus$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["isCompletedAttempt"])(row.status), working = row.status.toLowerCase() === 'in_progress';
                                    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("tr", {
                                        ...(0, __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Border$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["borderProps"])('exams'),
                                        "data-result-tone": row.status.toLowerCase() === 'terminated' ? 'terminated' : row.status.toLowerCase() === 'auto_submitted' ? 'automatic' : working ? 'working' : row.status.toLowerCase() === 'not_started' ? 'not-started' : 'submitted',
                                        children: [
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("td", {
                                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                    className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$AttemptCollection$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__["default"].exam,
                                                    children: [
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("strong", {
                                                            children: row.exam_title ?? '—'
                                                        }, void 0, false, {
                                                            fileName: "[project]/components/student/AttemptCollection.tsx",
                                                            lineNumber: 58,
                                                            columnNumber: 305
                                                        }, this),
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                            children: row.classes?.map((cls)=>cls.name).join(' · ') || '—'
                                                        }, void 0, false, {
                                                            fileName: "[project]/components/student/AttemptCollection.tsx",
                                                            lineNumber: 58,
                                                            columnNumber: 343
                                                        }, this)
                                                    ]
                                                }, void 0, true, {
                                                    fileName: "[project]/components/student/AttemptCollection.tsx",
                                                    lineNumber: 58,
                                                    columnNumber: 276
                                                }, this)
                                            }, void 0, false, {
                                                fileName: "[project]/components/student/AttemptCollection.tsx",
                                                lineNumber: 58,
                                                columnNumber: 272
                                            }, this),
                                            history ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Fragment"], {
                                                children: [
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("td", {
                                                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                            className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$AttemptCollection$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__["default"].attemptNumber,
                                                            children: row.attempt_number ?? '—'
                                                        }, void 0, false, {
                                                            fileName: "[project]/components/student/AttemptCollection.tsx",
                                                            lineNumber: 59,
                                                            columnNumber: 26
                                                        }, this)
                                                    }, void 0, false, {
                                                        fileName: "[project]/components/student/AttemptCollection.tsx",
                                                        lineNumber: 59,
                                                        columnNumber: 22
                                                    }, this),
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("td", {
                                                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(AttemptTime, {
                                                            value: row.started_at
                                                        }, void 0, false, {
                                                            fileName: "[project]/components/student/AttemptCollection.tsx",
                                                            lineNumber: 59,
                                                            columnNumber: 106
                                                        }, this)
                                                    }, void 0, false, {
                                                        fileName: "[project]/components/student/AttemptCollection.tsx",
                                                        lineNumber: 59,
                                                        columnNumber: 102
                                                    }, this),
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("td", {
                                                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(AttemptTime, {
                                                            value: row.submitted_at
                                                        }, void 0, false, {
                                                            fileName: "[project]/components/student/AttemptCollection.tsx",
                                                            lineNumber: 59,
                                                            columnNumber: 152
                                                        }, this)
                                                    }, void 0, false, {
                                                        fileName: "[project]/components/student/AttemptCollection.tsx",
                                                        lineNumber: 59,
                                                        columnNumber: 148
                                                    }, this),
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("td", {
                                                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                            className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$AttemptCollection$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__["default"].duration,
                                                            children: durationText(row, now)
                                                        }, void 0, false, {
                                                            fileName: "[project]/components/student/AttemptCollection.tsx",
                                                            lineNumber: 59,
                                                            columnNumber: 200
                                                        }, this)
                                                    }, void 0, false, {
                                                        fileName: "[project]/components/student/AttemptCollection.tsx",
                                                        lineNumber: 59,
                                                        columnNumber: 196
                                                    }, this)
                                                ]
                                            }, void 0, true) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("td", {
                                                children: score === null ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                    className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$AttemptCollection$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__["default"].pendingScore,
                                                    children: "Đang chờ chấm"
                                                }, void 0, false, {
                                                    fileName: "[project]/components/student/AttemptCollection.tsx",
                                                    lineNumber: 59,
                                                    columnNumber: 291
                                                }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                    className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$AttemptCollection$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__["default"].score,
                                                    children: [
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("strong", {
                                                            children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$teacher$2d$results$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["scoreText"])(score)
                                                        }, void 0, false, {
                                                            fileName: "[project]/components/student/AttemptCollection.tsx",
                                                            lineNumber: 59,
                                                            columnNumber: 381
                                                        }, this),
                                                        ' ',
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                            children: [
                                                                "/ ",
                                                                (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$teacher$2d$results$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["scoreText"])(row.max_score ?? null)
                                                            ]
                                                        }, void 0, true, {
                                                            fileName: "[project]/components/student/AttemptCollection.tsx",
                                                            lineNumber: 59,
                                                            columnNumber: 421
                                                        }, this)
                                                    ]
                                                }, void 0, true, {
                                                    fileName: "[project]/components/student/AttemptCollection.tsx",
                                                    lineNumber: 59,
                                                    columnNumber: 350
                                                }, this)
                                            }, void 0, false, {
                                                fileName: "[project]/components/student/AttemptCollection.tsx",
                                                lineNumber: 59,
                                                columnNumber: 273
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("td", {
                                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Badge$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["StatusBadge"], {
                                                    status: row.status,
                                                    label: (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$studentExamStatus$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["studentAttemptLabel"])(row.status)
                                                }, void 0, false, {
                                                    fileName: "[project]/components/student/AttemptCollection.tsx",
                                                    lineNumber: 60,
                                                    columnNumber: 15
                                                }, this)
                                            }, void 0, false, {
                                                fileName: "[project]/components/student/AttemptCollection.tsx",
                                                lineNumber: 60,
                                                columnNumber: 11
                                            }, this),
                                            !history && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("td", {
                                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(AttemptTime, {
                                                    value: row.submitted_at
                                                }, void 0, false, {
                                                    fileName: "[project]/components/student/AttemptCollection.tsx",
                                                    lineNumber: 60,
                                                    columnNumber: 109
                                                }, this)
                                            }, void 0, false, {
                                                fileName: "[project]/components/student/AttemptCollection.tsx",
                                                lineNumber: 60,
                                                columnNumber: 105
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("td", {
                                                children: history ? working ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["default"], {
                                                    className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$AttemptCollection$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__["default"].resultLink,
                                                    href: `/student/attempts/${encodeURIComponent(row.id)}`,
                                                    children: [
                                                        "Tiếp tục làm bài",
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$arrow$2d$right$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__ArrowRight$3e$__["ArrowRight"], {
                                                            size: 17,
                                                            "aria-hidden": "true"
                                                        }, void 0, false, {
                                                            fileName: "[project]/components/student/AttemptCollection.tsx",
                                                            lineNumber: 61,
                                                            columnNumber: 141
                                                        }, this)
                                                    ]
                                                }, void 0, true, {
                                                    fileName: "[project]/components/student/AttemptCollection.tsx",
                                                    lineNumber: 61,
                                                    columnNumber: 32
                                                }, this) : completed ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["default"], {
                                                    className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$AttemptCollection$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__["default"].resultLink,
                                                    href: `/student/attempts/${encodeURIComponent(row.id)}/result`,
                                                    children: [
                                                        "Chi tiết lần làm",
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$arrow$2d$right$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__ArrowRight$3e$__["ArrowRight"], {
                                                            size: 17,
                                                            "aria-hidden": "true"
                                                        }, void 0, false, {
                                                            fileName: "[project]/components/student/AttemptCollection.tsx",
                                                            lineNumber: 61,
                                                            columnNumber: 317
                                                        }, this)
                                                    ]
                                                }, void 0, true, {
                                                    fileName: "[project]/components/student/AttemptCollection.tsx",
                                                    lineNumber: 61,
                                                    columnNumber: 201
                                                }, this) : '—' : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["default"], {
                                                    className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$student$2f$AttemptCollection$2e$module$2e$css__$5b$app$2d$ssr$5d$__$28$css__module$29$__["default"].resultLink,
                                                    href: `/student/attempts/${encodeURIComponent(row.id)}/result`,
                                                    children: [
                                                        score === null ? 'Xem bài đã nộp' : 'Xem kết quả',
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$arrow$2d$right$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__ArrowRight$3e$__["ArrowRight"], {
                                                            size: 17,
                                                            "aria-hidden": "true"
                                                        }, void 0, false, {
                                                            fileName: "[project]/components/student/AttemptCollection.tsx",
                                                            lineNumber: 61,
                                                            columnNumber: 516
                                                        }, this)
                                                    ]
                                                }, void 0, true, {
                                                    fileName: "[project]/components/student/AttemptCollection.tsx",
                                                    lineNumber: 61,
                                                    columnNumber: 371
                                                }, this)
                                            }, void 0, false, {
                                                fileName: "[project]/components/student/AttemptCollection.tsx",
                                                lineNumber: 61,
                                                columnNumber: 11
                                            }, this)
                                        ]
                                    }, row.id, true, {
                                        fileName: "[project]/components/student/AttemptCollection.tsx",
                                        lineNumber: 58,
                                        columnNumber: 16
                                    }, this);
                                })
                            }, void 0, false, {
                                fileName: "[project]/components/student/AttemptCollection.tsx",
                                lineNumber: 56,
                                columnNumber: 7
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/components/student/AttemptCollection.tsx",
                        lineNumber: 54,
                        columnNumber: 126
                    }, this) : state.active ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["EmptySearchState"], {
                        mascot: true,
                        state: state
                    }, void 0, false, {
                        fileName: "[project]/components/student/AttemptCollection.tsx",
                        lineNumber: 64,
                        columnNumber: 27
                    }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ui$2f$Feedback$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["EmptyState"], {
                        mascot: true,
                        title: history ? 'Chưa có lịch sử làm bài.' : 'Chưa có bài kiểm tra đã hoàn thành.'
                    }, void 0, false, {
                        fileName: "[project]/components/student/AttemptCollection.tsx",
                        lineNumber: 64,
                        columnNumber: 68
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$collections$2f$CollectionToolbar$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["CollectionPagination"], {
                        state: state,
                        total: result.total,
                        count: rows.length
                    }, void 0, false, {
                        fileName: "[project]/components/student/AttemptCollection.tsx",
                        lineNumber: 65,
                        columnNumber: 5
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/components/student/AttemptCollection.tsx",
                lineNumber: 54,
                columnNumber: 64
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/components/student/AttemptCollection.tsx",
        lineNumber: 43,
        columnNumber: 10
    }, this);
}
}),
];

//# sourceMappingURL=_c1135175._.js.map