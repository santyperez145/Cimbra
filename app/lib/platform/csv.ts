export class CsvError extends Error {
  readonly row?: number;
  constructor(message: string, row?: number) { super(message); this.row = row; }
}

export function parseCsv(input: string, options: { maxRows?: number; maxColumns?: number; maxCellLength?: number } = {}) {
  const maxRows = options.maxRows ?? 501;
  const maxColumns = options.maxColumns ?? 16;
  const maxCellLength = options.maxCellLength ?? 512;
  const source = input.replace(/^\uFEFF/, '');
  if (source.includes('\0')) throw new CsvError('El archivo contiene bytes nulos.');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let closedQuote = false;

  const pushCell = () => {
    if (cell.length > maxCellLength) throw new CsvError(`Una celda supera ${maxCellLength} caracteres.`, rows.length + 1);
    row.push(cell);
    cell = '';
    closedQuote = false;
    if (row.length > maxColumns) throw new CsvError(`El archivo supera ${maxColumns} columnas.`, rows.length + 1);
  };
  const pushRow = () => {
    pushCell();
    if (row.some((value) => value.trim().length > 0)) rows.push(row);
    row = [];
    if (rows.length > maxRows) throw new CsvError(`El archivo supera ${maxRows - 1} partidas.`, rows.length);
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') { cell += '"'; index += 1; }
        else { quoted = false; closedQuote = true; }
      } else cell += character;
      continue;
    }
    if (closedQuote && character !== ',' && character !== '\n' && character !== '\r' && character !== ' ' && character !== '\t') {
      throw new CsvError('Hay contenido después del cierre de una celda entrecomillada.', rows.length + 1);
    }
    if (character === '"') {
      if (cell.trim().length > 0) throw new CsvError('Las comillas sólo pueden iniciar una celda.', rows.length + 1);
      cell = ''; quoted = true; closedQuote = false;
    } else if (character === ',') pushCell();
    else if (character === '\n') pushRow();
    else if (character === '\r') { if (source[index + 1] === '\n') index += 1; pushRow(); }
    else if (!closedQuote) cell += character;
  }
  if (quoted) throw new CsvError('El archivo contiene una celda entrecomillada sin cierre.', rows.length + 1);
  if (cell.length > 0 || row.length > 0) pushRow();
  if (rows.length === 0) throw new CsvError('El archivo CSV está vacío.');
  return rows;
}

function canonicalHeader(value: string) {
  return value.trim().replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[ -]+/g, '_').toLowerCase();
}

export function csvObjects(input: string) {
  const rows = parseCsv(input);
  const headers = rows[0].map(canonicalHeader);
  if (new Set(headers).size !== headers.length) throw new CsvError('El encabezado contiene columnas duplicadas.', 1);
  const required = ['external_reference', 'direction', 'amount'];
  for (const header of required) if (!headers.includes(header)) throw new CsvError(`Falta la columna ${header}.`, 1);
  const supported = new Set([...required, 'transaction_id']);
  for (const header of headers) if (!supported.has(header)) throw new CsvError(`La columna ${header || '(vacía)'} no está soportada.`, 1);
  return rows.slice(1).map((values, index) => {
    if (values.length !== headers.length) throw new CsvError('La cantidad de columnas no coincide con el encabezado.', index + 2);
    return Object.fromEntries(headers.map((header, column) => [header, values[column].trim()]));
  });
}
