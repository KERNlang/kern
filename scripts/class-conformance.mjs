/**
 * Class differential conformance — KERN single-source class parity.
 *
 * Each fixture is a self-contained KERN module: a class (or class hierarchy)
 * plus a zero-arg `fn probe` that exercises it. The module is compiled through
 * BOTH codegen paths (core -> TypeScript, python -> pure Python), each driver
 * calls `probe()` and prints its JSON-normalized return, and we assert
 * ts == python == expected. This proves class behavior is identical across
 * targets BY CONSTRUCTION (both derive from one definition), not by hand-diffing
 * two emitters.
 *
 * Scope: portable probes (number/string ops) plus portable list mutation —
 * `arr.push(x)` lowers identically in class methods and route handlers via the
 * shared `core/expr/list-ops` module, so per-instance list isolation is proven
 * differentially here (not only in unit tests). Other list ops (`.length`,
 * `.slice`, …) are a tracked follow-up; `.map`/`.filter` stay per-path.
 *
 * Run:  node scripts/class-conformance.mjs   (or via `pnpm check:class-conformance`)
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const { parse, generateCoreNode } = await import(join(REPO, 'packages/core/dist/index.js'));
const { generatePythonCoreNode } = await import(join(REPO, 'packages/python/dist/codegen-python.js'));
const tsCompiler = await import('typescript');

const FIXTURES = [
  {
    name: 'construction + fields + method',
    kern: `class name=Point export=true
  field name=x type=number
  field name=y type=number
  constructor
    param name=x type=number
    param name=y type=number
    handler
      assign target="this.x" value="x"
      assign target="this.y" value="y"
  method name=sum returns=number
    handler
      return value="this.x + this.y"
fn name=probe returns=number
  handler
    return value="new Point(3, 4).sum()"`,
    expected: 7,
  },
  {
    name: 'single inheritance + super constructor + super method',
    kern: `class name=Animal export=true
  field name=name type=string
  constructor
    param name=name type=string
    handler
      assign target="this.name" value="name"
  method name=describe returns=string
    handler
      return value="\`\${this.name} is an animal\`"
class name=Dog extends=Animal export=true
  constructor
    param name=name type=string
    handler
      do value="super(name)"
  method name=describe returns=string
    handler
      return value="\`\${super.describe()} (a dog)\`"
fn name=probe returns=string
  handler
    return value="new Dog(\\"Rex\\").describe()"`,
    expected: 'Rex is an animal (a dog)',
  },
  {
    name: 'instance getter',
    kern: `class name=Person export=true
  field name=first type=string
  field name=last type=string
  constructor
    param name=first type=string
    param name=last type=string
    handler
      assign target="this.first" value="first"
      assign target="this.last" value="last"
  getter name=full returns=string
    handler
      return value="\`\${this.first} \${this.last}\`"
fn name=probe returns=string
  handler
    return value="new Person(\\"Ada\\", \\"Lovelace\\").full"`,
    expected: 'Ada Lovelace',
  },
  {
    name: 'static method',
    kern: `class name=MathBox export=true
  method name=double static=true returns=number
    param name=n type=number
    handler
      return value="n * 2"
fn name=probe returns=number
  handler
    return value="MathBox.double(21)"`,
    expected: 42,
  },
  {
    name: 'instance field default (read, no constructor)',
    kern: `class name=Config export=true
  field name=mode type=string value={{ "dev" }}
fn name=probe returns=string
  handler
    return value="new Config().mode"`,
    expected: 'dev',
  },
  {
    name: 'getter + setter + field default round-trip',
    kern: `class name=Cell export=true
  field name=v type=number value={{ 0 }}
  getter name=value returns=number
    handler
      return value="this.v"
  setter name=value
    param name=next type=number
    handler
      assign target="this.v" value="next"
fn name=probe returns=number
  handler
    let name=c value="new Cell()"
    assign target="c.value" value="9"
    return value="c.value"`,
    expected: 9,
  },
  {
    name: 'static accessor read + write round-trip',
    kern: `class name=Counter export=true
  field name=_count type=number static=true value={{ 0 }}
  getter name=count static=true returns=number
    handler
      return value="this._count"
  setter name=count static=true
    param name=v type=number
    handler
      assign target="this._count" value="v"
fn name=probe returns=number
  handler
    assign target="Counter.count" value="Counter.count + 5"
    assign target="Counter.count" value="Counter.count + 5"
    return value="Counter.count"`,
    expected: 10,
  },
  {
    name: 'portable list mutation: per-instance isolation + push return parity',
    kern: `class name=Bag export=true
  field name=items type=number[] value={{ [] }}
  method name=add returns=number
    param name=x type=number
    handler
      return value="this.items.push(x)"
fn name=probe returns=number
  handler
    let name=a value="new Bag()"
    let name=b value="new Bag()"
    do value="a.add(10)"
    do value="a.add(20)"
    return value="b.add(99)"`,
    // Discriminating: b is a SEPARATE instance, so b.add returns 1 — not 3.
    // Kills (a) shared-mutable-default (items aliased -> b.add returns 3),
    // (b) push not lowered (Python `list.push` -> AttributeError, ts != py),
    // (c) push without JS return parity (`append` returns None -> b.add != 1).
    expected: 1,
  },
  {
    name: 'inherited + overridden static accessor (metaclass chaining)',
    kern: `class name=Base export=true
  field name=_val type=number static=true value={{ 0 }}
  getter name=val static=true returns=number
    handler
      return value="this._val"
  setter name=val static=true
    param name=v type=number
    handler
      assign target="this._val" value="v"
class name=Derived extends=Base export=true
  getter name=val static=true returns=number
    handler
      return value="this._val * 2"
  setter name=val static=true
    param name=v type=number
    handler
      assign target="this._val" value="v + 1"
fn name=probe returns=number
  handler
    assign target="Derived.val" value="5"
    return value="Derived.val"`,
    expected: 12,
  },
  {
    name: 'abstract class: erased at codegen, polymorphic dispatch to override',
    kern: `class name=Shape abstract=true export=true
  method name=area returns=number
class name=Square extends=Shape export=true
  field name=side type=number value={{ 3 }}
  method name=area returns=number
    handler
      return value="this.side * this.side"
fn name=measure returns=number
  param name=shape type=Shape
  handler
    return value="shape.area()"
fn name=probe returns=number
  handler
    return value="measure(new Square())"`,
    // `abstract` is erased on both targets (plain instantiable class), so a
    // Shape-typed reference dispatches to Square.area on TS AND Python.
    // Kills: Python dropping the override (AttributeError), the abstract base
    // stub running instead of the override (NotImplementedError != 9), and any
    // ABC/metaclass lowering that would make `new Square()` diverge.
    expected: 9,
  },
  {
    name: 'abstract method: template method calls override + inherited field default',
    kern: `class name=Formatter abstract=true export=true
  field name=prefix type=string value={{ "[" }}
  method name=suffix returns=string
  method name=format returns=string
    param name=input type=string
    handler
      return value="\`\${this.prefix}\${input}\${this.suffix()}\`"
class name=BracketFormatter extends=Formatter export=true
  method name=suffix returns=string
    handler
      return value="\\"]\\""
fn name=probe returns=string
  handler
    return value="new BracketFormatter().format(\\"test\\")"`,
    // The concrete `format` (inherited) reads the inherited field default
    // `prefix` and calls the abstract `suffix`, which dispatches to the override.
    // Kills: dropped inherited field default, dropped inherited concrete method,
    // and the abstract stub running instead of the BracketFormatter override.
    expected: '[test]',
  },
  {
    name: 'abstract static accessor: override dispatches through chained metaclass',
    kern: `class name=Base abstract=true export=true
  getter name=tag static=true returns=string
class name=Impl extends=Base export=true
  getter name=tag static=true returns=string
    handler
      return value="\\"impl\\""
fn name=probe returns=string
  handler
    return value="Impl.tag"`,
    // Abstract static getter on Base (fail-fast raise stub) + override on Impl,
    // dispatched through the chained metaclass _ImplMeta(type(Base)). Reading
    // Impl.tag resolves to the override on BOTH targets. Kills a Python lowering
    // where the abstract static stub is `pass` (returns None) instead of a raise,
    // or where the chained metaclass drops the override.
    expected: 'impl',
  },
  {
    name: 'derived constructor without super(): implicit base-init injected',
    kern: `class name=Base export=true
  field name=tag type=number value={{ 1 }}
class name=Box extends=Base export=true
  field name=x type=number value={{ 0 }}
  constructor
    param name=v type=number
    handler
      assign target="this.x" value="v"
  method name=get returns=number
    handler
      return value="this.x + this.tag"
fn name=probe returns=number
  handler
    return value="new Box(7).get()"`,
    // Box's constructor touches `this.x` but never calls super(). KERN injects an
    // implicit super() FIRST on both targets, so (a) TS doesn't crash with "must
    // call super before this", and (b) the base's `tag=1` default runs via that
    // super, giving get() = 7 + 1. Kills: no super injected (TS crash); super
    // injected AFTER this.x (TS crash); base init skipped (this.tag undefined ->
    // NaN on TS / AttributeError on Python); field defaults before super.
    expected: 8,
  },
  {
    name: 'liskov covariant return: override narrows return Animal -> Dog',
    kern: `class name=Animal export=true
  field name=sound type=string value={{ "generic" }}
  method name=make returns=Animal
    handler
      return value="new Animal()"
class name=Dog extends=Animal export=true
  field name=sound type=string value={{ "woof" }}
  method name=make returns=Dog
    handler
      return value="new Dog()"
fn name=probe returns=string
  handler
    return value="new Dog().make().sound"`,
    // The override narrows its return to Dog (a subtype of Animal); the produced
    // instance is a Dog, so reading .sound yields "woof" on both targets. The
    // validator must ACCEPT this covariant narrowing (no codegen change here).
    expected: 'woof',
  },
  {
    name: 'liskov contravariant param: override widens param Dog -> Animal',
    kern: `class name=Animal export=true
  field name=kind type=string value={{ "animal" }}
class name=Dog extends=Animal export=true
class name=Greeter export=true
  method name=greet returns=string
    param name=who type=Dog
    handler
      return value="\`greet \${who.kind}\`"
class name=LoudGreeter extends=Greeter export=true
  method name=greet returns=string
    param name=who type=Animal
    handler
      return value="\`hi \${who.kind}\`"
fn name=probe returns=string
  handler
    return value="new LoudGreeter().greet(new Animal())"`,
    // The override widens its param to Animal (a supertype of Dog) and is passed
    // an Animal; reading who.kind yields "animal" on both targets. The validator
    // must ACCEPT this contravariant widening.
    expected: 'hi animal',
  },
  {
    name: 'liskov grandparent-chain covariant return: A <- B <- C',
    kern: `class name=A export=true
  field name=tier type=string value={{ "A" }}
  method name=spawn returns=A
    handler
      return value="new A()"
class name=B extends=A export=true
  field name=tier type=string value={{ "B" }}
class name=C extends=B export=true
  field name=tier type=string value={{ "C" }}
  method name=spawn returns=C
    handler
      return value="new C()"
fn name=probe returns=string
  handler
    return value="new C().spawn().tier"`,
    // C overrides A's spawn (declared returns=A) with returns=C; C is a subtype
    // of A through the grandparent chain, so the narrowing is covariant and SOUND.
    // The returned instance is a C, so .tier is "C" on both targets.
    expected: 'C',
  },
  {
    name: 'liskov getter covariant return: override narrows getter Animal -> Dog',
    kern: `class name=Animal export=true
  field name=label type=string value={{ "animal" }}
class name=Dog extends=Animal export=true
  field name=label type=string value={{ "dog" }}
class name=Kennel export=true
  getter name=resident returns=Animal
    handler
      return value="new Animal()"
class name=DogKennel extends=Kennel export=true
  getter name=resident returns=Dog
    handler
      return value="new Dog()"
fn name=probe returns=string
  handler
    return value="new DogKennel().resident.label"`,
    // The getter override narrows its return to Dog (a subtype of Animal); the
    // produced instance is a Dog, so .label is "dog" on both targets. The
    // validator must ACCEPT covariant getter-return narrowing.
    expected: 'dog',
  },
  // ── list-ops parity (.length / .slice / .concat) shared between class + route ──
  // These prove the property hook (.length) and the slice/concat method shims
  // lower identically in class methods. Without the property hook a class
  // method's `this.items.length` emits invalid `self.items.length` (AttributeError
  // on Python -> ts != py). Each fixture's expected value is cross-target
  // deterministic and kills a specific wrong-impl.
  {
    name: 'list-ops F1: items.length after two pushes (property hook in class method)',
    kern: `class name=Bag export=true
  field name=items type=number[] value={{ [] }}
  method name=count returns=number
    handler
      do value="this.items.push(10)"
      do value="this.items.push(20)"
      return value="this.items.length"
fn name=probe returns=number
  handler
    return value="new Bag().count()"`,
    // Kills: property hook missing (self.items.length -> AttributeError on Python),
    // a method-shaped-only impl that never lowers non-call `.length`.
    expected: 2,
  },
  {
    name: 'list-ops F2: this.data.slice(-2).length (negative slice then length)',
    kern: `class name=Box export=true
  field name=data type=number[] value={{ [10, 20, 30, 40] }}
  method name=tail returns=number
    handler
      return value="this.data.slice(-2).length"
fn name=probe returns=number
  handler
    return value="new Box().tail()"`,
    // slice(-2) of [10,20,30,40] is [30,40]; its length is 2. Kills: negative
    // index mishandling, length-after-chain loss (the .length on a slice result).
    expected: 2,
  },
  {
    name: 'list-ops F3: slice() copies (aliasing) — original length unchanged',
    kern: `class name=Box export=true
  field name=data type=number[] value={{ [1, 2, 3] }}
  method name=keep returns=number
    handler
      let name=copy value="this.data.slice()"
      do value="copy.push(99)"
      return value="this.data.length"
fn name=probe returns=number
  handler
    return value="new Box().keep()"`,
    // slice() with no args COPIES; pushing to the copy must NOT grow the original,
    // so this.data.length stays 3. Kills: an aliasing slice (recv[:] -> recv) that
    // shares the underlying list (would give 4).
    expected: 3,
  },
  {
    name: 'list-ops F4: this.data.slice(1, 3).length (two-arg slice)',
    kern: `class name=Box export=true
  field name=data type=number[] value={{ [10, 20, 30, 40] }}
  method name=mid returns=number
    handler
      return value="this.data.slice(1, 3).length"
fn name=probe returns=number
  handler
    return value="new Box().mid()"`,
    // slice(1,3) of [10,20,30,40] is [20,30]; length 2. Kills: second-arg ignored
    // (recv[1:] -> length 3) and a recv[1:None]-style shape that drops the bound.
    expected: 2,
  },
  {
    name: 'list-ops F5: this.name.length on a STRING field (len works on str too)',
    kern: `class name=Box export=true
  field name=name type=string value={{ "hello" }}
  method name=size returns=number
    handler
      return value="this.name.length"
fn name=probe returns=number
  handler
    return value="new Box().size()"`,
    // "hello".length is 5. Kills a list-only len lowering — `.length` must lower
    // to `len(...)`, which works on Python strings as well as lists.
    expected: 5,
  },
  {
    name: 'list-ops F6a: this.base.concat([3,4]).length (array arg spreads)',
    kern: `class name=Box export=true
  field name=base type=number[] value={{ [1, 2] }}
  method name=joined returns=number
    handler
      return value="this.base.concat([3, 4]).length"
fn name=probe returns=number
  handler
    return value="new Box().joined()"`,
    // [1,2].concat([3,4]) is [1,2,3,4]; length 4. Kills a non-flattening concat
    // (array arg appended as one nested element -> length 3).
    expected: 4,
  },
  {
    name: 'list-ops F6b: this.base.concat(3) result (scalar arg appends)',
    kern: `class name=Box export=true
  field name=base type=number[] value={{ [1, 2] }}
  method name=appended returns=number[]
    handler
      return value="this.base.concat(3)"
fn name=probe returns=number[]
  handler
    return value="new Box().appended()"`,
    // [1,2].concat(3) is [1,2,3]. Printing the ARRAY (not its length) discriminates
    // a wrongly-nested concat: a wrong impl that appends [3] as a nested element
    // yields [1,2,[3]] — length 3 would NOT discriminate, but the JSON does.
    expected: [1, 2, 3],
  },
  // ── scalar-method sweep (includes/indexOf/join/flat/reverse/at/fill/lastIndexOf) ──
  // These 8 methods were route-only; lifting them into the shared list-ops module
  // makes a class method's `this.x.includes(v)` lower identically to the route path
  // (was invalid `self.x.includes(v)` -> AttributeError on Python). Each fixture's
  // expected value is cross-target deterministic and kills a named wrong-impl.
  {
    name: 'scalar S1: includes true/false (number array)',
    kern: `class name=Box export=true
  field name=data type=number[] value={{ [3, 1, 4] }}
  method name=both returns=boolean[]
    handler
      return value="[this.data.includes(1), this.data.includes(9)]"
fn name=probe returns=boolean[]
  handler
    return value="new Box().both()"`,
    // [3,1,4].includes(1) is true, .includes(9) is false. Kills an always-true impl.
    expected: [true, false],
  },
  {
    name: 'scalar S2: includes substring on a STRING field',
    kern: `class name=Box export=true
  field name=name type=string value={{ "hello" }}
  method name=has returns=boolean
    handler
      return value="this.name.includes(\\"ll\\")"
fn name=probe returns=boolean
  handler
    return value="new Box().has()"`,
    // "hello".includes("ll") is true via Python `in` (substring membership). Kills an
    // element-equality impl that would scan chars and never find the 2-char "ll".
    expected: true,
  },
  {
    name: 'scalar S3: indexOf first match (duplicate element)',
    kern: `class name=Box export=true
  field name=data type=number[] value={{ [5, 6, 7, 6] }}
  method name=where returns=number
    handler
      return value="this.data.indexOf(6)"
fn name=probe returns=number
  handler
    return value="new Box().where()"`,
    // [5,6,7,6].indexOf(6) is 1 (FIRST match). Kills an always-0 impl and a
    // lastIndexOf-style impl that would return 3.
    expected: 1,
  },
  {
    name: 'scalar S4: indexOf with fromIndex',
    kern: `class name=Box export=true
  field name=data type=number[] value={{ [5, 6, 7, 6] }}
  method name=where returns=number
    handler
      return value="this.data.indexOf(6, 2)"
fn name=probe returns=number
  handler
    return value="new Box().where()"`,
    // indexOf(6, 2) skips index 1 and finds the next 6 at index 3. Kills an impl
    // that ignores fromIndex (would return 1).
    expected: 3,
  },
  {
    name: 'scalar S5: join with separator coerces numbers',
    kern: `class name=Box export=true
  field name=data type=number[] value={{ [1, 2, 3] }}
  method name=joined returns=string
    handler
      return value="this.data.join(\\"-\\")"
fn name=probe returns=string
  handler
    return value="new Box().joined()"`,
    // [1,2,3].join("-") is "1-2-3". Kills an impl missing str() on numbers (TypeError
    // on Python `"-".join([1,2,3])`).
    expected: '1-2-3',
  },
  {
    name: 'scalar S6: join default separator is comma',
    kern: `class name=Box export=true
  field name=data type=string[] value={{ ["a", "b"] }}
  method name=joined returns=string
    handler
      return value="this.data.join()"
fn name=probe returns=string
  handler
    return value="new Box().joined()"`,
    // ["a","b"].join() defaults to "," -> "a,b". Kills a wrong default separator.
    expected: 'a,b',
  },
  {
    name: 'scalar S7: flat one level only (nested array preserved)',
    kern: `class name=Box export=true
  field name=data type=number[][] value={{ [[1, 2], [3, [4, 5]]] }}
  method name=flattened returns=number[]
    handler
      return value="this.data.flat()"
fn name=probe returns=number[]
  handler
    return value="new Box().flattened()"`,
    // [[1,2],[3,[4,5]]].flat() flattens ONE level -> [1,2,3,[4,5]]. Kills a recursive
    // flatten (which would yield [1,2,3,4,5]).
    expected: [1, 2, 3, [4, 5]],
  },
  {
    name: 'scalar S8: reverse mutates AND returns the reversed array',
    kern: `class name=Box export=true
  field name=data type=number[] value={{ [1, 2, 3] }}
  method name=rev returns=number[]
    handler
      return value="this.data.reverse()"
fn name=probe returns=number[]
  handler
    return value="new Box().rev()"`,
    // JS reverse() mutates AND RETURNS the reversed array; the shim is
    // `(recv.reverse() or recv)`. Returning the RESULT directly is the
    // discriminator: native Python `list.reverse()` returns None, so an
    // un-lowered/fall-through impl yields null on Python (RED at base, ts != py),
    // and a non-mutating copy impl would also diverge. The shim returns [3,2,1].
    // (A mutate-then-read-receiver shape is NON-discriminating here because
    // Python's native list.reverse already mutates in place — see report.)
    expected: [3, 2, 1],
  },
  {
    name: 'scalar S9: at(-1) negative index normalization',
    kern: `class name=Box export=true
  field name=data type=number[] value={{ [10, 20, 30] }}
  method name=last returns=number
    handler
      return value="this.data.at(-1)"
fn name=probe returns=number
  handler
    return value="new Box().last()"`,
    // [10,20,30].at(-1) is 30. Kills an impl with no negative normalization.
    expected: 30,
  },
  {
    name: 'scalar S10: at out-of-bounds is null (not IndexError)',
    kern: `class name=Box export=true
  field name=data type=number[] value={{ [10, 20] }}
  method name=oob returns=number[]
    handler
      return value="[this.data.at(9)]"
fn name=probe returns=number[]
  handler
    return value="new Box().oob()"`,
    // [10,20].at(9) is undefined in JS / None in Python -> wrapped as [null]. Kills a
    // bare `recv[n]` impl (IndexError on Python). The array-wrap makes the null
    // observable as JSON `[null]` on both targets.
    expected: [null],
  },
  {
    name: 'scalar S11: fill(value, start, end) return value (NEW list, bounds)',
    kern: `class name=Box export=true
  field name=data type=number[] value={{ [0, 0, 0, 0, 0] }}
  method name=filled returns=number[]
    handler
      let name=out value="this.data.fill(9, 1, 3)"
      return value="out"
fn name=probe returns=number[]
  handler
    return value="new Box().filled()"`,
    // The lowering is a comprehension returning a NEW list; we print the RETURN value,
    // never the receiver. [0,0,0,0,0].fill(9,1,3) fills [1,3) -> [0,9,9,0,0]. Kills an
    // off-by-one bounds impl.
    expected: [0, 9, 9, 0, 0],
  },
  {
    name: 'scalar S12: fill(value, start) negative start normalization',
    kern: `class name=Box export=true
  field name=data type=number[] value={{ [1, 2, 3, 4] }}
  method name=filled returns=number[]
    handler
      let name=out value="this.data.fill(7, -2)"
      return value="out"
fn name=probe returns=number[]
  handler
    return value="new Box().filled()"`,
    // fill(7, -2) on [1,2,3,4] normalizes -2 to index 2 -> [1,2,7,7]. Kills an impl
    // missing negative-index normalization.
    expected: [1, 2, 7, 7],
  },
  {
    name: 'scalar S13: lastIndexOf last match (array)',
    kern: `class name=Box export=true
  field name=data type=number[] value={{ [1, 2, 3, 2, 1] }}
  method name=where returns=number
    handler
      return value="this.data.lastIndexOf(2)"
fn name=probe returns=number
  handler
    return value="new Box().where()"`,
    // [1,2,3,2,1].lastIndexOf(2) is 3 (LAST match). Kills a first-index impl (-> 1).
    expected: 3,
  },
  {
    name: 'scalar S14: lastIndexOf substring on a STRING field',
    kern: `class name=Box export=true
  field name=name type=string value={{ "banana" }}
  method name=where returns=number
    handler
      return value="this.name.lastIndexOf(\\"na\\")"
fn name=probe returns=number
  handler
    return value="new Box().where()"`,
    // "banana".lastIndexOf("na") is 4 via rfind (multi-char substring). Kills an
    // element-scan impl that would treat the string char-by-char.
    expected: 4,
  },
  {
    name: 'scalar S15: impure receiver + slice(1) (single-eval, NOW lowers)',
    kern: `class name=Box export=true
  field name=data type=number[] value={{ [1, 2, 3] }}
  method name=fetch returns=number[]
    handler
      return value="this.data"
  method name=tail returns=number[]
    handler
      return value="this.fetch().slice(1)"
fn name=probe returns=number[]
  handler
    return value="new Box().tail()"`,
    // slice is single-eval (names the receiver once), so an IMPURE receiver
    // `this.fetch()` is now lowered (the old blanket guard wrongly skipped it,
    // the 0.97 agon-review finding). [1,2,3].slice(1) is [2,3]. This is THE fix proof.
    expected: [2, 3],
  },
  {
    name: 'scalar S16: impure receiver + includes (single-eval, NOW lowers)',
    kern: `class name=Box export=true
  field name=data type=number[] value={{ [1, 2, 3] }}
  method name=fetch returns=number[]
    handler
      return value="this.data"
  method name=has returns=boolean
    handler
      return value="this.fetch().includes(2)"
fn name=probe returns=boolean
  handler
    return value="new Box().has()"`,
    // includes is single-eval, so the impure receiver `this.fetch()` is now lowered
    // (same 0.97 finding). [1,2,3].includes(2) is true.
    expected: true,
  },
];

const canon = (v) => JSON.stringify(v);

const dir = mkdtempSync(join(tmpdir(), 'kern-class-conf-'));
process.on('exit', () => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort tmp cleanup — never fail the run on it
  }
});

let pass = 0;
const failures = [];

for (let i = 0; i < FIXTURES.length; i++) {
  const fx = FIXTURES[i];
  try {
    const root = parse(fx.kern);
    // A single top-level decl parses as the node itself; multiple decls wrap in a root.
    const topNodes = root.type === 'class' || root.type === 'fn' ? [root] : (root.children ?? []);

    // TypeScript module
    const tsSource = `${topNodes.map((n) => generateCoreNode(n).join('\n')).join('\n\n')}\nconsole.log(JSON.stringify(probe()));`;
    const tsFile = join(dir, `mod-${i}.mjs`);
    writeFileSync(
      tsFile,
      tsCompiler.transpileModule(tsSource, {
        compilerOptions: { module: tsCompiler.ModuleKind.ESNext, target: tsCompiler.ScriptTarget.ES2022 },
      }).outputText,
    );

    // Python module
    const pySource = `import json\n${topNodes.map((n) => generatePythonCoreNode(n).join('\n')).join('\n\n')}\nprint(json.dumps(probe()))`;
    const pyFile = join(dir, `mod-${i}.py`);
    writeFileSync(pyFile, pySource);

    const opts = { encoding: 'utf8', timeout: 10_000 };
    const tsOut = JSON.parse(execFileSync('node', [tsFile], opts).trim());
    const pyOut = JSON.parse(execFileSync('python3', [pyFile], opts).trim());

    if (canon(tsOut) === canon(fx.expected) && canon(pyOut) === canon(fx.expected)) {
      pass++;
    } else {
      failures.push({ name: fx.name, expected: fx.expected, ts: tsOut, py: pyOut });
    }
  } catch (err) {
    failures.push({ name: fx.name, error: err?.stderr?.toString?.() || err?.message || String(err) });
  }
}

console.log(`Class conformance: ${pass}/${FIXTURES.length} fixtures passed (ts == python == expected)`);
for (const f of failures) {
  if (f.error) console.error(`  FAIL ${f.name}: ${f.error}`);
  else console.error(`  FAIL ${f.name}: expected ${canon(f.expected)} | ts ${canon(f.ts)} | py ${canon(f.py)}`);
}
if (failures.length > 0) process.exit(1);
console.log('All passed.');
