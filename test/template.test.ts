/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, resolveDeep, setPath } from '../server/src/template.js';

const ctx = {
  input: { name: '  Asha ', amount: '1,250.50', items: [{ sku: 'A', qty: 2 }, { sku: 'B', qty: 3 }], tags: ['x', 'y'] },
  nodes: { 'Get order': { body: { id: 'A-1', 'odd.key': 7 } } },
};

test('whole-field references keep their type', () => {
  assert.deepEqual(resolve('{{input.items}}', ctx), ctx.input.items);
  assert.equal(resolve('{{ input.items[1].qty }}', ctx), 3);
  assert.equal(resolve('{{input.items[-1].sku}}', ctx), 'B');
  assert.equal(resolve('{{nodes.Get order.body.id}}', ctx), 'A-1');
  assert.equal(resolve('{{nodes.Get order.body["odd.key"]}}', ctx), 7);
});

test('text with several references becomes a string', () => {
  assert.equal(resolve('Order {{nodes.Get order.body.id}} x{{input.items[0].qty}}', ctx), 'Order A-1 x2');
  assert.equal(resolve('{"a": {{input.tags}}}', ctx), '{"a": ["x","y"]}');
});

test('pipes', () => {
  assert.equal(resolve('{{input.name | trim | upper}}', ctx), 'ASHA');
  assert.equal(resolve('{{input.amount | number | mul:2 | round:1}}', ctx), 2501);
  assert.equal(resolve('{{input.missing | default:"n/a"}}', ctx), 'n/a');
  assert.equal(resolve('{{input.items | map:"sku" | join:"|"}}', ctx), 'A|B');
  assert.equal(resolve('{{input.items | sum:"qty"}}', ctx), 5);
  assert.equal(resolve('{{"a<b" | xmlescape}}', ctx), 'a&lt;b');
  assert.equal(resolve('{{input.name | trim | concat:"-":nodes.Get order.body.id}}', ctx), 'Asha-A-1');
  assert.equal(resolve('{{"user:pw" | base64}}', ctx), 'dXNlcjpwdw==');
  assert.throws(() => resolve('{{input | nope}}', ctx), /Unknown pipe/);
});

test('pipes with separators inside quotes', () => {
  assert.equal(resolve('{{input.tags | join:" | "}}', ctx), 'x | y');
  assert.equal(resolve('{{"a:b" | replace:":":"-"}}', ctx), 'a-b');
});

test('resolveDeep and setPath', () => {
  assert.deepEqual(resolveDeep({ a: '{{input.items[0].sku}}', b: ['{{input.tags[1]}}'] }, ctx), { a: 'A', b: ['y'] });
  const o: any = {};
  setPath(o, 'customer.address.city', 'Pune');
  setPath(o, 'lines[0].sku', 'A');
  assert.deepEqual(o, { customer: { address: { city: 'Pune' } }, lines: [{ sku: 'A' }] });
});
