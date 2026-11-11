// Log identifiers and fixed error codes only. Never serialize requests, tokens or SDK errors.
export const log = (event, fields = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }));
export const errorCode = error => String(error?.status || error?.code || 'UNEXPECTED').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
