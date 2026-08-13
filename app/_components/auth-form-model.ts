export type AuthMode = "sign-in" | "sign-up";
export type AuthFieldName = "nameField" | "emailField" | "passwordField";
export type AuthFieldState = { value: string; error: string; touched: boolean };
export type AuthFormState = { mode: AuthMode; nameField: AuthFieldState; emailField: AuthFieldState; passwordField: AuthFieldState; serverError: string | null; successState: "signed-in" | "signed-up" | null };

export type AuthFormAction =
  | { type: "mode-changed"; mode: AuthMode }
  | { type: "field-changed"; field: AuthFieldName; value: string; error: string }
  | { type: "field-blurred"; field: AuthFieldName; error: string }
  | { type: "validation-failed"; fields: Partial<Record<AuthFieldName, string>> }
  | { type: "server-error"; message: string }
  | { type: "success"; state: "signed-in" | "signed-up" };

const untouched = (): AuthFieldState => ({ value: "", error: "", touched: false });
export const initialAuthFormState: AuthFormState = { mode: "sign-in", nameField: untouched(), emailField: untouched(), passwordField: untouched(), serverError: null, successState: null };

export function authFormReducer(state: AuthFormState, action: AuthFormAction): AuthFormState {
  switch (action.type) {
    case "mode-changed": return { ...state, mode: action.mode, serverError: null, successState: null, nameField: { ...state.nameField, error: "", touched: false }, emailField: { ...state.emailField, error: "", touched: false }, passwordField: { ...state.passwordField, error: "", touched: false } };
    case "field-changed": return { ...state, [action.field]: { ...state[action.field], value: action.value, error: action.error } };
    case "field-blurred": return { ...state, [action.field]: { ...state[action.field], error: action.error, touched: true } };
    case "validation-failed": return {
      ...state,
      ...Object.fromEntries(([
        "nameField",
        "emailField",
        "passwordField",
      ] as const).map((field) => [field, { ...state[field], error: action.fields[field] ?? "", touched: true }])),
    };
    case "server-error": return { ...state, serverError: action.message || null };
    case "success": return { ...state, successState: action.state };
  }
}
