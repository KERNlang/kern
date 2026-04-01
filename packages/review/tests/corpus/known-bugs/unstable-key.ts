// BUG: array index used as key in .map() — causes reconciliation issues
import React from 'react';

interface Item {
  id: string;
  text: string;
}

export function ItemList(props: { items: Item[] }) {
  return React.createElement(
    'ul',
    null,
    props.items.map((item, index) =>
      React.createElement('li', { key: index }, item.text) // unstable key
    )
  );
}
