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

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canon, makeTmpDir, runNode, runPython, transpileTs } from './conformance-helpers.mjs';

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
  {
    name: 'scalar S17: indexOf substring on a STRING field',
    kern: `class name=Box export=true
  field name=name type=string value={{ "hello" }}
  method name=where returns=number
    handler
      return value="this.name.indexOf(\\"ll\\")"
fn name=probe returns=number
  handler
    return value="new Box().where()"`,
    // "hello".indexOf("ll") is 2 via str.find (multi-char substring). RED at base:
    // the element-scan treated the string char-by-char and never matched -> -1.
    // Mirrors S14 (lastIndexOf str-receiver) for the indexOf direction.
    expected: 2,
  },
  {
    name: 'scalar S18: indexOf multi-char substring on a STRING field with fromIndex',
    kern: `class name=Box export=true
  field name=name type=string value={{ "hello" }}
  method name=where returns=number
    handler
      return value="this.name.indexOf(\\"lo\\", 2)"
fn name=probe returns=number
  handler
    return value="new Box().where()"`,
    // "hello".indexOf("lo", 2) is 3 (str.find with a start offset for the 2-char
    // substring "lo"). RED at base: the element-scan never matches the 2-char
    // needle and returns -1. Kills both the scan impl and a fromIndex-ignoring impl.
    expected: 3,
  },
  {
    // K1 — block-bodied arrow with a read-capture of an outer `const` (factor)
    // and a local `const` + return inside the block. Kills naive `lambda`
    // emission (statements in a Python lambda are invalid) and missing
    // read-capture (the def must close over `factor`).
    name: 'closure K1: block arrow, local const + outer read-capture',
    kern: `class name=Box export=true
  method name=run returns=number
    handler
      let name=factor value="3"
      let name=scale value="(x) => { const y = x * factor; return y; }"
      return value="scale(7)"
fn name=probe returns=number
  handler
    return value="new Box().run()"`,
    expected: 21,
  },
  {
    // K2 — if/else block body returning string literals. Kills
    // expression-only body handling (the block has two control-flow paths).
    name: 'closure K2: block arrow with if/else returning strings',
    kern: `class name=Box export=true
  method name=run returns=string
    handler
      let name=pick value="(x) => { if (x > 2) { return \\"big\\" } else { return \\"small\\" } }"
      return value="pick(5)"
fn name=probe returns=string
  handler
    return value="new Box().run()"`,
    expected: 'big',
  },
  {
    // K3 — closure reads the enclosing METHOD param `n` (capture across the
    // method signature). Kills param-capture scope bugs.
    name: 'closure K3: block arrow capturing a method param',
    kern: `class name=Box export=true
  method name=run returns=number
    param name=n type=number
    handler
      let name=add value="(x) => { const t = x + n; return t; }"
      return value="add(4)"
fn name=probe returns=number
  handler
    return value="new Box().run(6)"`,
    expected: 10,
  },
  {
    // K4 — expression-statement inside the block mutates a captured array
    // (`acc.push(...)`), then returns its length; the closure is also CALLED
    // as a `do` statement before the result is read. Kills hoist-ordering
    // bugs (the def must precede its use), over-broad write-rejection (a
    // method call on a capture must be allowed, not treated as a free-var
    // write), and missing expression-statement support.
    name: 'closure K4: block arrow mutating a captured array via method call',
    kern: `class name=Box export=true
  method name=run returns=number[]
    handler
      let name=acc value="[]"
      let name=grab value="(x) => { acc.push(x * 2); return acc.length; }"
      do value="grab(3)"
      return value="acc"
fn name=probe returns=number[]
  handler
    return value="new Box().run()"`,
    expected: [6],
  },
  {
    // K5 — the closure is used TWICE in one expression (`inc(inc(5))`). Kills
    // one-shot / inlined-def impls that can only reference the closure once.
    name: 'closure K5: block arrow invoked twice (nested calls)',
    kern: `class name=Box export=true
  method name=run returns=number
    handler
      let name=inc value="(x) => { return x + 1; }"
      return value="inc(inc(5))"
fn name=probe returns=number
  handler
    return value="new Box().run()"`,
    expected: 7,
  },
  {
    // K6 — block arrow invoked inside an IF CONDITION (header position). Kills
    // the hoist-buffer recursion-steal bug (agon review, claude 0.7): without
    // per-level buffer isolation the def is spliced INSIDE the if body — after
    // `if __kern_closure_0(2):` already referenced it — a runtime NameError on
    // Python while TS is fine. Correct placement is BEFORE the `if` header.
    name: 'closure K6: block arrow called in an if-condition (header hoist)',
    kern: `class name=Box export=true
  method name=run returns=number
    handler
      if cond="((x) => { return x > 1; })(2)"
        return value="10"
      return value="20"
fn name=probe returns=number
  handler
    return value="new Box().run()"`,
    expected: 10,
  },
  {
    // K7 — block arrow invoked in a WHILE CONDITION. Same header-position
    // hazard as K6 for the loop header; the def binds once before the loop
    // (capture-free closure, so def-once ≡ JS per-evaluation semantics).
    name: 'closure K7: block arrow called in a while-condition (header hoist)',
    kern: `class name=Box export=true
  method name=run returns=number
    handler
      let name=i value="0" kind=let
      while cond="((n) => { return n < 3; })(i)"
        assign target="i" value="i + 1"
      return value="i"
fn name=probe returns=number
  handler
    return value="new Box().run()"`,
    expected: 3,
  },
  {
    // K8 — block arrow invoked in an ELIF condition (the else>[if] chain shape
    // the Python emitter collapses to `elif`). Python cannot hold a `def`
    // between `if` and `elif`, so the only correct placement is before the
    // WHOLE chain — which per-level buffer isolation produces. Kills any
    // "flush before the immediately-enclosing header line" impl that would
    // emit an illegal def between branches.
    name: 'closure K8: block arrow called in an elif-condition (chain hoist)',
    kern: `class name=Box export=true
  method name=pick params="n:number" returns=number
    handler
      if cond="n > 10"
        return value="1"
      else
        if cond="((x) => { return x === 5; })(n)"
          return value="2"
        else
          return value="3"
fn name=probe returns=number
  handler
    return value="new Box().pick(5)"`,
    expected: 2,
  },
  {
    // P1 — THE classic loop-variable capture. A closure created per iteration
    // of `each x` reads `x`. JS re-binds `x` per iteration, so each closure
    // sees its own value → [0,1,2]. A naive Python hoisted def late-binds the
    // captured name → all closures see the LAST value → [2,2,2]. The fix pins
    // `x` via a default arg (`def __kern_closure_N(p, x=x):`).
    name: 'closure P1: per-iteration each-var capture (classic 0,1,2)',
    kern: `fn name=probe returns=number[]
  handler lang=kern
    let name=fns value="[]"
    each name=x in="[0, 1, 2]"
      do value="fns.push((p) => { return x; })"
    let name=out value="[]"
    each name=f in="fns"
      do value="out.push(f(0))"
    return value="out"`,
    expected: [0, 1, 2],
  },
  {
    // P2 — a body-LOCAL per-iteration binding (`const t` declared inside the
    // each body) is also re-bound every iteration in JS. The closure captures
    // `t`; correct = [10,20]. Without pinning the captured local late-binds to
    // the last value → [20,20].
    name: 'closure P2: body-local per-iteration const capture',
    kern: `fn name=probe returns=number[]
  handler lang=kern
    let name=fns value="[]"
    each name=x in="[1, 2]"
      let name=t value="x * 10"
      do value="fns.push((p) => { return t; })"
    let name=out value="[]"
    each name=f in="fns"
      do value="out.push(f(0))"
    return value="out"`,
    expected: [10, 20],
  },
  {
    // P3 — an OUTSIDE-loop binding (`total`, declared before the loop) is
    // captured by reference: JS closures see its CURRENT value at call time.
    // `total` is mutated to 3 AFTER the loop, then both closures are called →
    // [3,3]. OVER-pinning would freeze the per-iteration value (0) → [0,0],
    // wrong. Python late binding is already parity-correct here, so `total`
    // must NOT be pinned.
    name: 'closure P3: outside-loop binding NOT pinned (by-reference)',
    kern: `fn name=probe returns=number[]
  handler lang=kern
    let name=total value="0" kind=let
    let name=fns value="[]"
    each name=x in="[1, 2]"
      do value="fns.push((p) => { return total; })"
    assign target="total" value="3"
    let name=out value="[]"
    each name=f in="fns"
      do value="out.push(f(0))"
    return value="out"`,
    expected: [3, 3],
  },
  {
    // P4 — a `while` CONDITION variable (`i`) is declared outside the loop.
    // Closures created inside the while body capture `i` by reference; after
    // the loop `i` is 2, so both closures return 2 → [2,2]. Over-pinning the
    // while-condition var would freeze the per-iteration values → [0,1], wrong.
    // (Per-iteration locals inside a while body DO pin — see P2 — but the
    // condition var declared OUTSIDE does not.)
    name: 'closure P4: while-condition var NOT pinned (by-reference)',
    kern: `fn name=probe returns=number[]
  handler lang=kern
    let name=i value="0" kind=let
    let name=fns value="[]"
    while cond="i < 2"
      do value="fns.push((p) => { return i; })"
      assign target="i" value="i + 1"
    let name=out value="[]"
    each name=f in="fns"
      do value="out.push(f(0))"
    return value="out"`,
    expected: [2, 2],
  },
  {
    // P5 — TRIBUNAL KILL-SWITCH PROBE. Inside `each x`, an `if`-block
    // re-declares `x` (shadow → __k_shadow_x_N) initialized from a sibling
    // per-iteration local `base` (= x + 100) — NOT from `x` itself, which
    // would be a TS temporal-dead-zone ReferenceError. The closure reads the
    // INNER shadowed `x` (101, 102 per iteration). Correct capture-set
    // resolution pins the RENAMED inner name → [101,102]. If the TS-AST
    // free-var set disagrees with the KERN rename resolution (captures the
    // outer loop `x`, or fails to pin the renamed inner name), the values
    // diverge ([2,2] from the outer loop var, or [102,102] late-bound on the
    // un-pinned renamed name). The closure references the renamed name in BOTH
    // its body and its pinned default param.
    name: 'closure P5: shadowed inner per-iteration binding (kill-switch)',
    kern: `fn name=probe returns=number[]
  handler lang=kern
    let name=fns value="[]"
    each name=x in="[1, 2]"
      let name=base value="x + 100"
      if cond="x > 0"
        let name=x value="base" kind=let
        do value="fns.push((p) => { return x; })"
    let name=out value="[]"
    each name=f in="fns"
      do value="out.push(f(0))"
    return value="out"`,
    expected: [101, 102],
  },
  {
    // P6 — nested loops. The INNER each (`y`) creates closures that read both
    // the inner var `y` AND the outer loop var `x`. BOTH are per-iteration
    // bindings AT or INSIDE the outermost loop-body scope, so BOTH must pin.
    // Inner-loop-only pinning leaves `x` late-bound → wrong (all closures see
    // x's last value 2). Correct = [11,21,12,22].
    name: 'closure P6: nested loops pin BOTH loop vars',
    kern: `fn name=probe returns=number[]
  handler lang=kern
    let name=fns value="[]"
    each name=x in="[1, 2]"
      each name=y in="[10, 20]"
        do value="fns.push((p) => { return x + y; })"
    let name=out value="[]"
    each name=f in="fns"
      do value="out.push(f(0))"
    return value="out"`,
    expected: [11, 21, 12, 22],
  },
  {
    // P7 — the `for` RANGE node (distinct from `each`). The for-loop variable
    // `i` is per-iteration in JS; closures created in the body must pin it →
    // [0,1,2]. If the for-node body is not marked as a loop scope, `i` stays
    // late-bound → [2,2,2] (or the post-loop deleted-name shape).
    name: 'closure P7: for-range loop var pinned',
    kern: `fn name=probe returns=number[]
  handler lang=kern
    let name=fns value="[]"
    for name=i from=0 to=3
      do value="fns.push((p) => { return i; })"
    let name=out value="[]"
    each name=f in="fns"
      do value="out.push(f(0))"
    return value="out"`,
    expected: [0, 1, 2],
  },
  // ── lambda-bearing array methods (map/filter/some/every) on the class/native
  //    Python path. These methods are NOT in the shared portable list-ops set
  //    (push/slice/concat/…), so at base a class method's `this.data.map(...)`
  //    falls through to a verbatim `self.data.map(...)` emit → Python lists have
  //    no `.map` → AttributeError (RED at base, ts != py). The new
  //    `lowerLambdaArrayCallPython` peek lowers them to a call-by-name
  //    comprehension. Each fixture kills a specific wrong-impl.
  {
    name: 'lambda M1: this.data.map((x) => x * 2) — expression lambda',
    kern: `class name=Box export=true
  field name=data type=number[] value={{ [1, 2, 3] }}
  method name=doubled returns=number[]
    handler
      return value="this.data.map((x) => x * 2)"
fn name=probe returns=number[]
  handler
    return value="new Box().doubled()"`,
    // [1,2,3].map(x => x*2) is [2,4,6]. Kills a verbatim `.map(` emit
    // (AttributeError on Python) and any non-mapping shape.
    expected: [2, 4, 6],
  },
  {
    name: 'lambda M2: map with a BLOCK lambda (hoisted def ordering)',
    kern: `class name=Box export=true
  field name=data type=number[] value={{ [1, 2, 3] }}
  method name=squared returns=number[]
    handler
      return value="this.data.map((x) => { const y = x + 1; return y * y; })"
fn name=probe returns=number[]
  handler
    return value="new Box().squared()"`,
    // map(x => { const y=x+1; return y*y }) over [1,2,3] is [4,9,16]. Kills a
    // block-lambda mis-lowered at the comprehension site: the hoisted
    // `def __kern_closure_N` must precede the statement whose comprehension
    // calls it. A NameError (def spliced after use) is RED at base.
    expected: [4, 9, 16],
  },
  {
    name: 'lambda M3: map with 2-arity callback (enumerate index)',
    kern: `class name=Box export=true
  method name=indexed returns=number[]
    handler
      return value="[10, 20, 30].map((x, i) => x + i)"
fn name=probe returns=number[]
  handler
    return value="new Box().indexed()"`,
    // [10,20,30].map((x,i) => x+i) is [10,21,32]. Kills a single-arg lowering
    // that drops the index param (would NameError on `i`, or emit `x+0`).
    expected: [10, 21, 32],
  },
  {
    name: 'lambda M4: filter predicate returns ARRAY — js_truthy contract',
    kern: `class name=Box export=true
  method name=kept returns=number[]
    handler
      return value="[1, 2, 3].filter((x) => [])"
fn name=probe returns=number[]
  handler
    return value="new Box().kept()"`,
    // JS keeps `[]` truthy, so filter(x => []) keeps EVERY element → [1,2,3].
    // Bare Python truthiness drops `[]` (empty list is falsy) → would give [].
    // THE contract fixture: only a `js_truthy(...)`-wrapped predicate matches JS.
    expected: [1, 2, 3],
  },
  {
    name: 'lambda M5: filter with a modulo predicate',
    kern: `class name=Box export=true
  field name=data type=number[] value={{ [1, 2, 3, 4] }}
  method name=evens returns=number[]
    handler
      return value="this.data.filter((x) => x % 2 === 0)"
fn name=probe returns=number[]
  handler
    return value="new Box().evens()"`,
    // [1,2,3,4].filter(x => x%2===0) is [2,4]. Kills comprehension-if basics
    // (a verbatim `.filter(` emit is AttributeError at base).
    expected: [2, 4],
  },
  {
    name: 'lambda M6: receiver evaluated ONCE (side-effecting bump())',
    kern: `class name=Counter export=true
  field name=count type=number value={{ 0 }}
  method name=bump returns=number[]
    handler
      assign target="this.count" value="this.count + 1"
      return value="[1, 2, 3]"
  method name=run
    handler
      let name=mapped value="this.bump().map((x) => x * 2)"
      return value="[mapped, this.count]"
fn name=probe
  handler
    return value="new Counter().run()"`,
    // `this.bump()` mutates count and returns [1,2,3]; mapping doubles → [2,4,6].
    // The receiver must be named ONCE in the comprehension, so bump() runs ONCE
    // and count is 1. A double-eval template (recv named twice) would run bump()
    // twice → count 2 (RED for a redundant-receiver-eval impl).
    expected: [[2, 4, 6], 1],
  },
  {
    name: 'lambda M7: chained map().filter()',
    kern: `class name=Box export=true
  method name=chain returns=number[]
    handler
      return value="[1, 2, 3, 4].map((x) => x * 2).filter((x) => x > 4)"
fn name=probe returns=number[]
  handler
    return value="new Box().chain()"`,
    // [1,2,3,4].map(x=>x*2) is [2,4,6,8]; .filter(x=>x>4) is [6,8]. Kills a
    // lowering that can't nest (the filter receiver is itself a lowered map
    // comprehension).
    expected: [6, 8],
  },
  {
    name: 'lambda M8: every over array-of-arrays — js_truthy on every',
    kern: `class name=Box export=true
  method name=truthy returns=boolean
    handler
      return value="[[], []].every((x) => x)"
fn name=probe returns=boolean
  handler
    return value="new Box().truthy()"`,
    // JS: [[],[]].every(x => x) is true ([] is truthy). Bare Python `all([], [])`
    // would treat empty lists as falsy → false. Only a js_truthy-wrapped
    // predicate inside all(...) matches JS → true.
    expected: true,
  },
  {
    name: 'lambda M9: some — false then true (any() basics + bool parity)',
    kern: `class name=Box export=true
  method name=results returns=boolean[]
    handler
      return value="[[0, 1].some((x) => x > 1), [0, 1, 2].some((x) => x > 1)]"
fn name=probe returns=boolean[]
  handler
    return value="new Box().results()"`,
    // [0,1].some(x=>x>1) is false (no element > 1); [0,1,2].some(...) is true.
    // Kills an always-true / always-false any() lowering; the boolean[] print
    // proves true/false parity across targets.
    expected: [false, true],
  },
  {
    name: 'lambda M10: bare LOCAL identifier callback',
    kern: `class name=Box export=true
  field name=data type=number[] value={{ [1, 2] }}
  method name=tripled returns=number[]
    handler
      let name=f value="(x) => x * 3"
      return value="this.data.map(f)"
fn name=probe returns=number[]
  handler
    return value="new Box().tripled()"`,
    // `let f = x => x*3; this.data.map(f)` — the callback is a bare LOCAL ident
    // (ValueIR `ident`, NOT a member chain), so it lowers to `[f(__kern_el) for
    // __kern_el in self.data]` → [3,6]. Kills an impl that only handles inline
    // lambdas and falls through (AttributeError) on a named callback.
    expected: [3, 6],
  },
  // ── instanceof hardening + host Error mapping (Python target) ──────────────
  // I1-I4, I8 are regression guards: user-class RHS already works (same-file
  // Python classes). I5-I7 exercise the new host mappings (Array→list,
  // Error→Exception for BOTH `new Error(...)` and `instanceof Error`).
  {
    name: 'I1: new Dog() instanceof Dog (user class, self)',
    kern: `class name=Dog export=true
  method name=speak returns=string
    handler
      return value="\\"woof\\""
fn name=probe returns=boolean
  handler
    return value="new Dog() instanceof Dog"`,
    // RHS is a user class in scope on both targets → isinstance(Dog(), Dog).
    // Kills a not-lowered impl (verbatim `instanceof` is a Python SyntaxError).
    expected: true,
  },
  {
    name: 'I2: Cat extends Animal; new Cat() instanceof Animal',
    kern: `class name=Animal export=true
  method name=kind returns=string
    handler
      return value="\\"animal\\""
class name=Cat extends=Animal export=true
  method name=meow returns=string
    handler
      return value="\\"meow\\""
fn name=probe returns=boolean
  handler
    return value="new Cat() instanceof Animal"`,
    // Subclass instance vs base class → true. Kills a `type(x) == Y` /
    // name-compare impl (isinstance honors the MRO; type()== does not).
    expected: true,
  },
  {
    name: 'I3: 3-level chain, grandchild instanceof grandparent',
    kern: `class name=Animal export=true
  method name=kind returns=string
    handler
      return value="\\"animal\\""
class name=Pet extends=Animal export=true
  method name=owned returns=boolean
    handler
      return value="true"
class name=Cat extends=Pet export=true
  method name=meow returns=string
    handler
      return value="\\"meow\\""
fn name=probe returns=boolean
  handler
    return value="new Cat() instanceof Animal"`,
    // Cat → Pet → Animal: grandchild instance vs grandparent. Kills a
    // single-level (direct-base-only) impl.
    expected: true,
  },
  {
    name: 'I4: new Cat() instanceof Dog (sibling class)',
    kern: `class name=Animal export=true
  method name=kind returns=string
    handler
      return value="\\"animal\\""
class name=Cat extends=Animal export=true
  method name=meow returns=string
    handler
      return value="\\"meow\\""
class name=Dog extends=Animal export=true
  method name=woof returns=string
    handler
      return value="\\"woof\\""
fn name=probe returns=boolean
  handler
    return value="new Cat() instanceof Dog"`,
    // Siblings under a shared base → false. Kills an always-true impl.
    expected: false,
  },
  {
    name: 'I5: [1, 2] instanceof Array → host Array→list mapping',
    kern: `fn name=probe returns=boolean
  handler
    return value="[1, 2] instanceof Array"`,
    // RHS ident `Array` must lower to `isinstance([1, 2], list)` on Python
    // (RED at base: emits `isinstance(..., Array)` → NameError). On TS it is
    // native (`[1,2] instanceof Array` → true). Kills a missing Array→list map.
    expected: true,
  },
  {
    name: 'I6: new Dog() instanceof Array → false (Array mapping not too broad)',
    kern: `class name=Dog export=true
  method name=woof returns=string
    handler
      return value="\\"woof\\""
fn name=probe returns=boolean
  handler
    return value="new Dog() instanceof Array"`,
    // A class instance is NOT a list → false. Kills a too-broad Array mapping
    // (e.g. one that maps Array→object). RED at base (NameError on `Array`).
    expected: false,
  },
  {
    name: 'I7: try/throw new Error; catch e: e instanceof Error ? "err" : "other"',
    kern: `fn name=probe returns=string
  handler
    try
      throw value="new Error(\\"boom\\")"
      catch name=e
        return value="e instanceof Error ? \\"err\\" : \\"other\\""
    return value="\\"never\\""`,
    // Exercises BOTH host Error mappings: `new Error("boom")` must lower to
    // `Exception("boom")` (else `raise Error(...)` → NameError) AND
    // `e instanceof Error` must lower to `isinstance(e, Exception)` (else
    // NameError on `Error`). RED at base on Python; native on TS.
    expected: 'err',
  },
  {
    name: 'I8: !(new Cat() instanceof Dog) → true (negation precedence)',
    kern: `class name=Animal export=true
  method name=kind returns=string
    handler
      return value="\\"animal\\""
class name=Cat extends=Animal export=true
  method name=meow returns=string
    handler
      return value="\\"meow\\""
class name=Dog extends=Animal export=true
  method name=woof returns=string
    handler
      return value="\\"woof\\""
fn name=probe returns=boolean
  handler
    return value="!(new Cat() instanceof Dog)"`,
    // `not isinstance(Cat(), Dog)` → true. Guards negation precedence around
    // the lowered isinstance call.
    expected: true,
  },
  // ── closure MUTATION v1 (MUT1-MUT8) ────────────────────────────────────────
  // Statement-position mutation inside block-bodied closures: bare local/free
  // assigns (incl. compound + statement-position ++/--), and index member
  // writes. RED at base: the v1 gate REJECTED every assignment shape
  // (closure-free-var-assign / closure-local-assign / closure-member-assign) →
  // a compile error at `parseExpression`. Now the gate accepts the shapes, the
  // lowerer emits Python assignment statements, and `emitBlockClosurePy`
  // prepends `nonlocal` for free writes (or throws closure-pinned-write for a
  // per-iteration loop capture). Each kills a specific wrong-impl.
  {
    // MUT1 — read+write of a method-LOCAL free var across three calls. RED at
    // base: gate rejected (closure-free-var-assign). Without `nonlocal` the def
    // raises UnboundLocalError (read of `n` before the local write) or, if the
    // shadow somehow initialized, accumulates 1,1,1. Correct = [1,2,3].
    name: 'closure MUT1: free-var read+write needs nonlocal (accumulate)',
    kern: `fn name=probe returns=number[]
  handler lang=kern
    let name=n value="0" kind=let
    let name=inc value="() => { n = n + 1; return n; }"
    return value="[inc(), inc(), inc()]"`,
    expected: [1, 2, 3],
  },
  {
    // MUT2 — index member write on a captured list mutates BY REFERENCE (no
    // nonlocal). Called twice → acc[0] = 2. RED at base: gate rejected
    // (closure-member-assign). Kills a copied-object / not-emitted member-write
    // impl. (Adapted from the spec's `acc.total` object-member form to an
    // INDEX write: native-body dict-attribute access — `acc.total` on a Python
    // dict — is a SEPARATE pre-existing gap outside this slice; an index write
    // proves the same by-reference member-mutation contract and lowers cleanly
    // on both targets.)
    name: 'closure MUT2: index member write mutates captured object by reference',
    kern: `fn name=probe returns=number
  handler lang=kern
    let name=acc value="[0]"
    let name=f value="() => { acc[0] = acc[0] + 1; return 0; }"
    do value="f()"
    do value="f()"
    return value="acc[0]"`,
    expected: 2,
  },
  {
    // MUT3 — compound assignment (`x *= 2`) on a free var. RED at base: gate
    // rejected. Kills a not-lowered compound (a verbatim `x *= 2` through the
    // expression path has no assignment grammar). Correct = 20.
    name: 'closure MUT3: compound *= on a free var',
    kern: `fn name=probe returns=number
  handler lang=kern
    let name=x value="10" kind=let
    let name=f value="() => { x *= 2; return 0; }"
    do value="f()"
    return value="x"`,
    expected: 20,
  },
  {
    // MUT4 — statement-position `x++` lowers to `x += 1` with `nonlocal`. RED
    // at base: gate rejected. Called twice → 2. Kills a dropped/not-lowered
    // postfix increment.
    name: 'closure MUT4: statement-position ++ lowers to += 1',
    kern: `fn name=probe returns=number
  handler lang=kern
    let name=x value="0" kind=let
    let name=f value="() => { x++; return 0; }"
    do value="f()"
    do value="f()"
    return value="x"`,
    expected: 2,
  },
  {
    // MUT5 — a free-var write nested inside an if-branch. RED at base: gate
    // rejected. The `nonlocal` declaration must hoist to the def's first body
    // line even though the write lives inside a nested block. Correct = true.
    name: 'closure MUT5: nonlocal write inside a nested if-branch',
    kern: `fn name=probe returns=boolean
  handler lang=kern
    let name=flag value="false" kind=let
    let name=f value="() => { if (flag === false) { flag = true; } return 0; }"
    do value="f()"
    return value="flag"`,
    expected: true,
  },
  {
    // MUT6 — two SEPARATE closures share one captured binding: `inc` writes
    // `count`, `get` reads it. RED at base: gate rejected. Kills a per-def
    // private-copy impl (each def must `nonlocal` the SAME outer `count`, not a
    // local snapshot). inc() twice then get() → 2.
    name: 'closure MUT6: two defs share one captured binding',
    kern: `fn name=probe returns=number
  handler lang=kern
    let name=count value="0" kind=let
    let name=inc value="() => { count++; return 0; }"
    let name=get value="() => { return count; }"
    do value="inc()"
    do value="inc()"
    return value="get()"`,
    expected: 2,
  },
  {
    // MUT7 — write to a closure PARAM, not a free var. RED at base: the gate
    // mis-saw `x` as free (params are stripped before the block is parsed) and
    // rejected closure-free-var-assign. Now: gate accepts the bare-ident shape,
    // and the LOWERER excludes params from the written-free set → a plain
    // def-local assignment, NO nonlocal. Correct = 5 (a misroute to nonlocal
    // would raise/return wrong; a reject would be a compile error).
    name: 'closure MUT7: param write is a def-local (no nonlocal, no reject)',
    kern: `fn name=probe returns=number
  handler lang=kern
    let name=f value="(x) => { x = x + 1; return x; }"
    return value="f(4)"`,
    expected: 5,
  },
  {
    // MUT8 — pinned-read + nonlocal-write COEXIST in one looped closure. Inside
    // `each x`, the closure reads the per-iteration `x` (PINNED via default arg
    // `x=x`) AND writes the outside-loop accumulator `outer` (NONLOCAL). RED at
    // base: gate rejected. Kills a pin/nonlocal conflict (a name cannot be both;
    // here they are different names and both mechanisms must apply in ONE def).
    // Also re-proves pinning: x is [1,2] not [2,2]. Correct = [[1,2],2].
    // (returns=number[] is a non-enforcing annotation; the value is nested.)
    name: 'closure MUT8: pinned per-iteration read + nonlocal outer write coexist',
    kern: `fn name=probe returns=number[]
  handler lang=kern
    let name=outer value="0" kind=let
    let name=fns value="[]"
    each name=x in="[1, 2]"
      do value="fns.push(() => { outer = outer + 1; return x; })"
    let name=r value="[]"
    each name=f in="fns"
      do value="r.push(f())"
    return value="[r, outer]"`,
    expected: [[1, 2], 2],
  },
  {
    // MUT9 — write to a SHADOW-RENAMED capture targets the renamed binding.
    // The inner `let x` shadows the outer (Python rename `__k_shadow_x_N`); the
    // closure's `x = x + 10` must write THAT binding — nonlocal, write target,
    // and reads all rename-resolved together. RED before the lowerAssignTarget
    // fix: the write went to the OUTER x while reads hit the renamed inner one
    // (f() returned 2, outer corrupted to 12 → [2, 2, 12]). Correct JS: f()=12,
    // inner x=12, outer x untouched → [12, 12, 1].
    name: 'closure MUT10: member/index inc-dec on a captured object (gate/lowerer lockstep)',
    kern: `fn name=probe returns=number[]
  handler lang=kern
    let name=acc value="[10, 5]"
    let name=f value="() => { acc[0]++; acc[1]--; return 0; }"
    do value="f()"
    do value="f()"
    return value="acc"`,
    // The gate accepts member/index ++/-- (by-reference mutation); the lowerer
    // must too (agon review: kimi 0.9 + zai 0.9 found the drift — emitIncDec
    // required a bare ident and eligible code died 'unsupported-statement').
    // [10,5] → two f() calls → [12, 3]. No nonlocal involved.
    expected: [12, 3],
  },
  {
    name: 'lambda-array FR11: TERNARY receiver parenthesized in generator heads + reduceRight slice',
    kern: `fn name=probe returns=number[]
  handler lang=kern
    let name=xs value="[1, 2]"
    let name=ys value="[3, 4]"
    let name=c value="true"
    let name=m value="(c ? xs : ys).map((x) => x * 10)"
    let name=r value="(c ? ys : xs).reduceRight((a, b) => a - b)"
    return value="[m, r]"`,
    // A compound (ternary) receiver dropped bare into `for el in <recv>` makes
    // Python read the `if` as the comprehension filter (SyntaxError), and
    // `<recv>[::-1]` slices only the rightmost branch (agon review, agy 1.0).
    // parenthesizeIterable wraps compound receivers: map over xs → [10,20];
    // reduceRight over ys=[3,4] reversed → 4-3=1. RED at base: SyntaxError.
    expected: [[10, 20], 1],
  },
  {
    name: 'closure MUT9: write to shadow-renamed capture targets the renamed binding',
    kern: `fn name=probe returns=number[]
  handler lang=kern
    let name=x value="1" kind=let
    let name=out value="[]"
    if cond="true"
      let name=x value="2" kind=let
      let name=f value="() => { x = x + 10; return x; }"
      do value="out.push(f())"
      do value="out.push(x)"
    do value="out.push(x)"
    return value="out"`,
    expected: [12, 12, 1],
  },
  // ── find-family + flatMap + reduce on the class/native Python path (FR1-FR10) ──
  // Same `lowerLambdaArrayCallPython` call-by-name architecture as map/filter.
  // RED at base: a class method's `this.data.find(...)` falls through to a
  // verbatim `self.data.find(...)` emit → Python lists have no `.find`/`.flatMap`
  // → AttributeError (ts != py). The new lowering emits a `next((... ), None/-1)`
  // generator, a single-call flatMap comprehension, and `__k_functools.reduce`.
  {
    name: 'FR1: find first element > 2 (expression lambda)',
    kern: `fn name=probe returns=number
  handler lang=kern
    return value="[1, 2, 3, 4].find((x) => x > 2)"`,
    // [1,2,3,4].find(x => x>2) is 3 (first match). Kills a not-lowered impl
    // (AttributeError on Python) and a filter-style impl that returns the array.
    expected: 3,
  },
  {
    name: 'FR2: find with no match is null (JSON-wrapped)',
    kern: `fn name=probe returns=number[]
  handler lang=kern
    return value="[[1, 2].find((x) => x > 5)]"`,
    // [1,2].find(x => x>5) is undefined in JS / None in Python → wrapped as [null]
    // (the at() null-printing precedent). Kills a wrong miss value (e.g. -1 / [] /
    // an exception when next() has no default).
    expected: [null],
  },
  {
    name: 'FR3: findIndex vs findLastIndex on a duplicated element',
    kern: `fn name=probe returns=number[]
  handler lang=kern
    let name=a value="[1, 2, 3, 2].findIndex((x) => x === 2)"
    let name=b value="[1, 2, 3, 2].findLastIndex((x) => x === 2)"
    return value="[a, b]"`,
    // findIndex finds the FIRST 2 at index 1; findLastIndex finds the LAST at
    // index 3. Kills a reversed-scan that is missing/wrong (both would be equal,
    // or the last-index would be 1).
    expected: [1, 3],
  },
  {
    name: 'FR4: findLast vs find (no conflation)',
    kern: `fn name=probe returns=number[]
  handler lang=kern
    let name=first value="[1, 2, 3, 2].find((x) => x < 3)"
    let name=last value="[1, 2, 3, 2].findLast((x) => x < 3)"
    return value="[first, last]"`,
    // find(x => x<3) is 1 (first match); findLast(x => x<3) is 2 (last match,
    // the trailing 2). Kills find/findLast conflation (both equal) and a
    // reversed-scan that drops the last match.
    expected: [1, 2],
  },
  {
    name: 'FR5: flatMap maps then flattens one level',
    kern: `fn name=probe returns=number[]
  handler lang=kern
    return value="[1, 2, 3].flatMap((x) => [x, x * 10])"`,
    // [1,2,3].flatMap(x => [x, x*10]) is [1,10,2,20,3,30]. Kills a not-lowered
    // impl (AttributeError) and a non-flattening map (would give [[1,10],...]).
    expected: [1, 10, 2, 20, 3, 30],
  },
  {
    name: 'FR6: flatMap calls the callback EXACTLY ONCE per element (single-eval purity)',
    kern: `fn name=probe returns=number[]
  handler lang=kern
    let name=n value="0" kind=let
    let name=cb value="(x) => { n = n + 1; return [x]; }"
    let name=r value="[1, 2, 3].flatMap(cb)"
    return value="[r, n]"`,
    // The class-path flatMap binds the callback result ONCE per element
    // (`for __kern_r_N in [cb(el)]`), so the side-effecting `n` counter ends at 3
    // — NOT 6. The route's body-substitution double-eval would call cb twice per
    // element → n = 6 (RED for that shape). Also an integration probe for the
    // closure-mutation slice: the free-var write `n = n + 1` needs `nonlocal`.
    expected: [[1, 2, 3], 3],
  },
  {
    name: 'FR7: reduce vs reduceRight (seedless, order-sensitive)',
    kern: `fn name=probe returns=string[]
  handler lang=kern
    let name=l value="[\\"a\\", \\"b\\", \\"c\\"].reduce((a, c) => a + c)"
    let name=r value="[\\"a\\", \\"b\\", \\"c\\"].reduceRight((a, c) => a + c)"
    return value="[l, r]"`,
    // reduce concatenates left-to-right → "abc"; reduceRight right-to-left → "cba".
    // Order-sensitive (asserts functools.reduce(acc, cur) arg order parity and the
    // [::-1] reversal). Seedless handling — no seed arg.
    expected: ['abc', 'cba'],
  },
  {
    name: 'FR8: reduce with a seed',
    kern: `fn name=probe returns=number
  handler lang=kern
    return value="[1, 2, 3].reduce((a, c) => a + c, 10)"`,
    // [1,2,3].reduce((a,c) => a+c, 10) is 16. Kills a seed-dropped impl (would be 6).
    expected: 16,
  },
  {
    name: 'FR9: reduce with a BLOCK lambda callback (def usable in functools.reduce)',
    kern: `fn name=probe returns=number
  handler lang=kern
    return value="[1, 2, 3].reduce((a, c) => { const t = a + c; return t; }, 0)"`,
    // A block-bodied 2-param callback hoists to a `def __kern_closure_N` whose
    // NAME is passed to functools.reduce. [1,2,3] seed 0 → 6. Kills an impl that
    // can only pass inline expression lambdas (a def name must work too).
    expected: 6,
  },
  {
    name: 'FR10: chained flatMap().find()',
    kern: `fn name=probe returns=number
  handler lang=kern
    return value="[[1], [2, 3]].flatMap((xs) => xs).find((x) => x > 1)"`,
    // [[1],[2,3]].flatMap(xs => xs) is [1,2,3]; .find(x => x>1) is 2. Kills a
    // lowering that can't nest (the find receiver is itself a lowered flatMap
    // comprehension).
    expected: 2,
  },

  // ── Enum (namespace-class) parity ──────────────────────────────────────
  // Each enum lowers to a TS `enum` and a Python plain namespace class whose
  // members are bare int/str. The discriminators below are version-INDEPENDENT
  // and kill every alternative Python representation (enum.Enum / IntEnum /
  // StrEnum / metaclass):
  //   - `member == N` and arithmetic `member + 1` give the NUMBER for a bare
  //     int (our impl) but FAIL or differ for enum.Enum (== is False, + is a
  //     TypeError). [The IntEnum killer is the emitted-source unit test, since
  //     IntEnum passes the arithmetic/JSON probes — see packages/python tests.]
  //   - string-member CONCAT works on a bare str but TypeErrors on enum.Enum.
  //   - JSON serialization of the probe return is the harness default path;
  //     enum.Enum members are not JSON-serializable (TypeError), so any
  //     Enum-subclass impl diverges hard here too.
  {
    name: 'ENUM1: implicit numeric (values=) — member value + equality',
    kern: `enum name=Status values="Pending|Active|Done"
fn name=probe returns=boolean
  handler lang=kern
    return value="Status.Active == 1"`,
    // values= auto-numbers 0,1,2 (mirrors TS). A bare int Active is exactly 1 →
    // True. enum.Enum's Active == 1 is False (kills the Enum representation).
    expected: true,
  },
  {
    name: 'ENUM2: explicit + implicit-after-explicit numeric members',
    kern: `enum name=Mixed
  member name=A value=10
  member name=B
  member name=C value=30
  member name=D
fn name=probe
  handler lang=kern
    return value="[Mixed.A, Mixed.B, Mixed.C, Mixed.D]"`,
    // TS auto-increment after an explicit numeric: A=10, B=11, C=30, D=31
    // (verified against tsc runtime). A counter that ignores the explicit reset
    // (e.g. 10,0,30,0 or 0,1,2,3) diverges — this is the discriminating mixed case.
    expected: [10, 11, 30, 31],
  },
  {
    name: 'ENUM3: explicit string members — concat + value',
    kern: `enum name=Dir
  member name=Up value="UP"
  member name=Down value="DOWN"
fn name=probe returns=string
  handler lang=kern
    return value="Dir.Up + Dir.Down"`,
    // Bare str members concat to "UPDOWN". enum.Enum members TypeError on `+`
    // (kills Enum); a StrEnum would concat but the source-shape unit test kills it.
    expected: 'UPDOWN',
  },
  {
    name: 'ENUM4: const=true enum used in an expression',
    kern: `enum name=Flag const=true values="On|Off"
fn name=probe returns=number
  handler lang=kern
    return value="Flag.On + Flag.Off"`,
    // const=true emits the SAME class (no inlining); On=0, Off=1 → 0+1=1.
    expected: 1,
  },
  {
    name: 'ENUM5: enum member passed as a function argument',
    kern: `enum name=Status values="Pending|Active|Done"
fn name=ident returns=number
  param name=x type=number
  handler lang=kern
    return value="x"
fn name=probe returns=number
  handler lang=kern
    return value="ident(Status.Done)"`,
    // Status.Done is the bare int 2, passed through identity → 2.
    expected: 2,
  },
  {
    name: 'ENUM6: enum member as a class field default',
    kern: `enum name=Status values="Pending|Active|Done"
class name=Task
  field name=state type=number default=Status.Active
  method name=read returns=number
    handler lang=kern
      return value="this.state"
fn name=probe returns=number
  handler lang=kern
    return value="new Task().read()"`,
    // The field default Status.Active (= 1) initializes per-instance on both
    // targets; reading it back yields 1.
    expected: 1,
  },
  {
    name: 'ENUM7: fmt interpolation of a member prints the VALUE',
    kern: `enum name=Status values="Pending|Active|Done"
fn name=probe returns=string
  handler lang=kern
    return value="\`v=\${Status.Done}\`"`,
    // A bare int interpolates as "2". enum.Enum would interpolate the member
    // repr ("Status.Done") on every version (kills Enum). NOTE: IntEnum prints
    // the number on 3.11+ but the member name on 3.10, so this fixture is NOT a
    // reliable IntEnum killer — the emitted-source unit test is.
    expected: 'v=2',
  },
  {
    name: 'ENUM8: arithmetic on a numeric member (member + 1)',
    kern: `enum name=Status values="Pending|Active|Done"
fn name=probe returns=number
  handler lang=kern
    return value="Status.Pending + 1"`,
    // Status.Pending (0) + 1 = 1. enum.Enum has no __add__ → TypeError (kills Enum).
    expected: 1,
  },
  {
    name: 'ENUM9: float member seeds the implicit counter (bare member after 1.5 is 2.5)',
    kern: `enum name=F
  member name=A value=1.5
  member name=B
fn name=probe
  handler lang=kern
    return value="[F.A, F.B]"`,
    // TS auto-increment is value+1 for ANY finite numeric, not just integers:
    // A=1.5 makes the next bare member 2.5 (verified against tsc runtime). An
    // integer-only counter silently emitted B=0 — caught at gate, fixed.
    expected: [1.5, 2.5],
  },
  {
    name: 'ENUM10: bare members after an expression-valued member chain symbolically (A={{1 << 0}} → B = A + 1)',
    kern: `enum name=Mixed
  member name=A value={{1 << 0}}
  member name=B
  member name=C
fn name=probe
  handler lang=kern
    return value="[Mixed.A, Mixed.B, Mixed.C]"`,
    // TS evaluates the constant expression and auto-increments: A=1, B=2, C=3.
    // Python emits the symbolic successor (B = A + 1, C = B + 1) — same values
    // by construction. A stale numeric counter emitted B=0 (kern-codex review,
    // verified blocking — fixed).
    expected: [1, 2, 3],
  },
];

const dir = makeTmpDir('kern-class-conf-');

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
    writeFileSync(tsFile, transpileTs(tsCompiler, tsSource));

    // Python module
    const pySource = `import json\n${topNodes.map((n) => generatePythonCoreNode(n).join('\n')).join('\n\n')}\nprint(json.dumps(probe()))`;
    const pyFile = join(dir, `mod-${i}.py`);
    writeFileSync(pyFile, pySource);

    const tsOut = JSON.parse(runNode(tsFile));
    const pyOut = JSON.parse(runPython(pyFile));

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
