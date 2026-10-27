declare const __AUTOFLOW_MOTION__: boolean;

/** Build-time isolation: Studio keeps its existing metering and development settings. */
export const IS_MOTION = typeof __AUTOFLOW_MOTION__ !== 'undefined' && __AUTOFLOW_MOTION__;
