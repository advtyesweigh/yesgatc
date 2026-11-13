import { useMemo, useState } from 'react';
import { filterGasAllottedChoices } from '../lib/serialEntryPool';

const VISIBLE_CAP = 80;

export function AvailableSerialList({
  serials,
  disabled,
  onPick,
}: {
  serials?: readonly string[];
  disabled?: boolean;
  onPick: (serial: string) => void;
}) {
  const [query, setQuery] = useState('');
  const hits = useMemo(
    () => (serials ? filterGasAllottedChoices(serials, query) : []),
    [query, serials],
  );

  if (!serials) return null;

  return (
    <div className="available-serials">
      <p className="available-serials__label">Unused stickers ({serials.length})</p>
      {serials.length === 0 ? (
        <p className="ov-self-serial-hint ov-self-serial-hint--muted">
          None listed. Type the number on the plate.
        </p>
      ) : (
        <>
          <input
            type="search"
            className="input-field available-serials__search"
            placeholder="Search unused stickers"
            value={query}
            disabled={disabled}
            onChange={event => setQuery(event.target.value)}
            aria-label="Search unused stickers"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
          {hits.length === 0 ? (
            <p className="ov-self-serial-hint ov-self-serial-hint--muted">No sticker matches.</p>
          ) : (
            <ul className="available-serials__list">
              {hits.slice(0, VISIBLE_CAP).map(serial => (
                <li key={serial}>
                  <button
                    type="button"
                    className="available-serials__item"
                    disabled={disabled}
                    onClick={() => onPick(serial)}
                  >
                    {serial}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {hits.length > VISIBLE_CAP ? (
            <p className="ov-self-serial-hint ov-self-serial-hint--muted">
              Showing {VISIBLE_CAP} of {hits.length}. Search to narrow.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
