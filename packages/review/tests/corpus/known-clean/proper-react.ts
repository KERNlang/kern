// CLEAN: correct hook usage at top level, stable keys, side effects in useEffect
import React, { useEffect, useState } from 'react';

interface Item {
  id: string;
  text: string;
}

export function ItemList(props: { items: Item[] }) {
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    console.log('Selected:', selected);
  }, [selected]);

  return React.createElement(
    'ul',
    null,
    props.items.map((item) =>
      React.createElement('li', { key: item.id, onClick: () => setSelected(item.id) }, item.text),
    ),
  );
}
