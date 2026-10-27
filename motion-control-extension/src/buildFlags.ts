declare const __MOTION_BILLING_CHECK__: boolean;

/**
 * Whether this build checks the Motion subscription before it generates.
 *
 * True in every build but `npm run build:test`: a local test build for while
 * Motion billing is not deployed. That build is renamed "TEST BUILD" and the
 * store packager refuses it. Read through typeof so that tests, and any build
 * that does not define the flag, get the real check.
 */
export const MOTION_BILLING_CHECK = typeof __MOTION_BILLING_CHECK__ === 'undefined' || __MOTION_BILLING_CHECK__;
