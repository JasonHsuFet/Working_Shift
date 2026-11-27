// Choosing a person sets $store.app.employee; the personal tab watches it.
import Alpine from './alpine.js';
import * as schedule from './schedule.js';
import { employees, state, router, EMP_ID_KEY } from './context.js';
import { element } from './dom.js';

// <datalist> filters by substring, so the list holds only IDs that start with the typed text.
function suggest(value) {
    const typed = schedule.normalizeEmpId(value);
    state.suggestions = typed ? [...employees.values()].filter(person => person.empId.startsWith(typed)).sort((left, right) => left.empId.localeCompare(right.empId, undefined, { numeric: true })).slice(0, 10) : [];
}

function showEmployeeForm(error) {
    state.employee = null;
    state.empError = error;
    state.empInvalid = Boolean(error);
}

function selectEmployee(empId) {
    const selected = employees.get(empId);
    state.empInput = empId;
    if (!selected) {
        showEmployeeForm('此工號不在本次班表資料中，請確認工號。');
        return;
    }
    state.empError = '';
    state.empInvalid = false;
    try { localStorage.setItem(EMP_ID_KEY, empId); } catch (_) { }
    state.employee = selected;
}

export function clearEmployee() {
    try { localStorage.removeItem(EMP_ID_KEY); } catch (_) { }
    showEmployeeForm('');
    state.empInput = '';
    router.navigate('/personal');
    Alpine.nextTick(() => element('empId').focus());
}

Alpine.data('employeeForm', () => ({
    suggest() { suggest(state.empInput); },
    submit() { router.navigate(`/personal/${encodeURIComponent(schedule.normalizeEmpId(state.empInput))}`, { replace: true }); }
}));

Alpine.data('employeeDialog', () => ({
    value: '',
    invalid: false,
    suggest() { suggest(this.value); },
    submit() {
        const empId = schedule.normalizeEmpId(this.value);
        this.invalid = !employees.has(empId);
        if (this.invalid) return;
        this.$root.close();
        router.navigate(`/personal/${encodeURIComponent(empId)}`, { replace: true });
    },
    closed() {
        if (!state.employee) element('empId').focus();
    }
}));

// Only the first visit without a known employee gets the dialog; later ones (e.g. after 清除工號) use the inline form.
let asked = false;
export function routePersonal(empId) {
    if (!empId) {
        let remembered = null;
        try { remembered = localStorage.getItem(EMP_ID_KEY); } catch (_) { }
        const known = state.employee?.empId || (employees.has(remembered) ? remembered : null);
        if (known) {
            router.navigate(`/personal/${encodeURIComponent(known)}`, { replace: true });
            return;
        }
        if (!asked) {
            asked = true;
            state.empError = '請輸入工號以檢視個人班表。';
            const dialog = element('empDialog');
            // No <dialog> support: use the inline form.
            if (dialog.showModal) dialog.showModal();
            else element('empId').focus();
        }
        return;
    }
    const normalized = schedule.normalizeEmpId(empId);
    if (normalized !== empId) {
        router.navigate(`/personal/${encodeURIComponent(normalized)}`, { replace: true });
        return;
    }
    asked = true;
    selectEmployee(normalized);
}
