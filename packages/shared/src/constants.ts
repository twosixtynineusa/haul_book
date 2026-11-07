export const APP_NAME = 'Haul Book';
export const APP_VERSION = '0.1.0';

/** Upload limits enforced by the API and mirrored in the web dropzone. */
export const MAX_UPLOAD_FILES = 20;
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/**
 * Begin Odo written when no reading is given. ProMiles rejects a trip row unless
 * columns A–I all have a value; `1` is the placeholder ProMiles' own example uses.
 */
export const DEFAULT_BEGIN_ODO = '1';
