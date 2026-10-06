import { useEffect, useState } from 'react';
import type { HistoryEntry } from '@shared/types/api';
import { Notice } from '../components/common';
import { call, errorMessage } from '../services/api';

export function HistoryPage() {
  const [search, setSearch] = useState('');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => {
      call('history:list', { search, order }).then(
        (r) => {
          setEntries(r.entries);
          setError('');
        },
        (e: unknown) => setError(errorMessage(e)),
      );
    }, 200);
    return () => window.clearTimeout(t);
  }, [search, order]);

  return (
    <section>
      <h1>Redemption history</h1>
      <div className="row wrap">
        <label>
          Search by name or voucher ID
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={80} autoComplete="off" />
        </label>
        <button type="button" className="secondary" onClick={() => setOrder(order === 'desc' ? 'asc' : 'desc')}>
          Sort: {order === 'desc' ? 'newest first' : 'oldest first'}
        </button>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <table className="table">
        <caption className="sr-only">Redeemed vouchers</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Amount</th>
            <th scope="col">Created</th>
            <th scope="col">Redeemed</th>
            <th scope="col">Reference</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.voucherId}>
              <td>{e.fullName}</td>
              <td>{e.amountDisplay}</td>
              <td>{e.dateCreatedUk}</td>
              <td>
                {e.redeemedDateUk} {e.redeemedTime}
              </td>
              <td title={e.voucherId}>{e.reference}</td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr>
              <td colSpan={5}>No redeemed vouchers found.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
