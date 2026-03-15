'use client';

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export function InteractiveSearch() {
  const { t } = useTranslation();
  const [query, setQuery] = useState();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [filteredItems, setFilteredItems] = useState([]);

  useEffect(() => {
        setLoading(true);
        const timer = setTimeout(() => {
          const nextItems = [
            'Apple Watch',
            'Bluetooth Speaker',
            'Desk Lamp',
            'Mechanical Keyboard',
            'Noise Cancelling Headphones',
          ];
          setItems(nextItems);
          setFilteredItems(
            nextItems.filter((item) => item.toLowerCase().includes(query.toLowerCase()))
          );
          setLoading(false);
        }, 250);
  
        return () => clearTimeout(timer);
      }, [query]);

  return (
    <div className="p-6 bg-gray-50 space-y-8">
      <div className="gap-4 flex flex-col">
        <span className="text-2xl font-bold text-zinc-900">{t('searchInventory', 'Search Inventory')}</span>
        <p className="text-sm text-zinc-600">{t('typeAProductNameToFilterTheLiveResults', 'Type a product name to filter the live results.')}</p>
        <input className="p-3 rounded-lg bg-white [border:#d4d4d8]" />
        <div className="justify-between items-center flex">
          <span className="text-sm text-zinc-900">{loading ? "Refreshing..." : (filteredItems.length + " matches")}</span>
          <span className="text-sm text-zinc-500">{query.length > 0 ? "Filter: " + query : "All items"}</span>
        </div>
        {!loading && (
          <>
            <div className="space-y-2">
              <div>
              </div>
              <div>
              </div>
              <div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}