// Employee ID entry: the inline form, the first-visit dialog, prefix autocomplete and the /personal route.
import * as schedule from './schedule.js';
import { employees, state, router, EMP_ID_KEY } from './context.js';
import { element, notice } from './dom.js';
import { showEmployee } from './personal.js';

// <datalist> filters by substring, so the list is rebuilt to hold only IDs that start with the typed text.
function suggestEmployees(event) {
    const typed = schedule.normalizeEmpId(event.target.value);
    const matches = typed ? [...employees.values()].filter(person => person.empId.startsWith(typed)).sort((left, right) => left.empId.localeCompare(right.empId, undefined, { numeric: true })).slice(0, 10) : [];
    element('empList').replaceChildren(...matches.map(person => {
        const option = document.createElement('option');
        option.value = person.empId;
        option.label = person.name;
        return option;
    }));
}
for (const id of ['empId', 'empDialogId']) element(id).addEventListener('input', suggestEmployees);

function showEmployeeForm(error) {
    state.employee = null;
    element('personalSchedule').hidden = true;
    element('employeeForm').hidden = false;
    notice('employeeError', error);
    element('empId').toggleAttribute('aria-invalid', Boolean(error));
}

// Shows a known employee from the loaded months; an unknown ID keeps the form with an error.
function selectEmployee(empId) {
    const selected = employees.get(empId);
    element('empId').value = empId;
    if (!selected) {
        showEmployeeForm('此工號不在本次班表資料中，請確認工號。');
        return;
    }
    element('empId').removeAttribute('aria-invalid');
    notice('employeeError', '');
    element('personalSchedule').hidden = false;
    element('employeeForm').hidden = true;
    try { localStorage.setItem(EMP_ID_KEY, empId); } catch (_) { }
    showEmployee(selected);
}

element('employeeForm').addEventListener('submit', event => {
    event.preventDefault();
    router.navigate(`/personal/${encodeURIComponent(schedule.normalizeEmpId(element('empId').value))}`, { replace: true });
});
element('clearEmployee').addEventListener('click', () => {
    try { localStorage.removeItem(EMP_ID_KEY); } catch (_) { }
    showEmployeeForm('');
    element('empId').value = '';
    router.navigate('/personal');
    element('empId').focus();
});

const dialog = element('empDialog');
element('empDialogForm').addEventListener('submit', event => {
    event.preventDefault();
    const empId = schedule.normalizeEmpId(element('empDialogId').value);
    const error = element('empDialogError');
    error.hidden = employees.has(empId);
    if (!error.hidden) {
        element('empDialogId').setAttribute('aria-invalid', 'true');
        return;
    }
    dialog.close();
    router.navigate(`/personal/${encodeURIComponent(empId)}`, { replace: true });
});
element('empDialogSkip').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => { if (!state.employee) element('empId').focus(); });

// Only the first visit without a known employee asks in a dialog; later visits (e.g. after 清除工號) use the inline form.
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
            notice('employeeError', '請輸入工號以檢視個人班表。');
            // Browsers without <dialog> fall back to the inline form.
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
