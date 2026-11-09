export const err = (status: number, message: string) => Object.assign(new Error(message), { status });
export const int = (x: any, min = 1) => { const n = Number(x); if (!Number.isInteger(n) || n < min) throw err(400, 'Numero intero non valido'); return n; };
