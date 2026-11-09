from pathlib import Path
import sys
import unittest

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / 'scripts'))

from actors import npc_batch
from actors.effect_bundle_packing import native_class_closure, pack_items_by_class_closure
import native_effect_bundle
from native_catalog.ue2 import FormatError

SYNTHETIC_CLOSURES = {
    'first': ('Core.Object', 'Engine.Actor', 'Synthetic.first'),
    'second': ('Core.Object', 'Engine.Actor', 'Synthetic.second'),
    'third': ('Core.Object', 'Engine.Actor', 'Synthetic.third'),
    'fourth': ('Core.Object', 'Engine.Actor', 'Synthetic.fourth'),
    'wide': ('Core.Object', 'Engine.Actor', 'Synthetic.wide_a', 'Synthetic.wide_b', 'Synthetic.wide_c'),
}


def synthetic_closure_of(item):
    return SYNTHETIC_CLOSURES[item]


class SyntheticClassPackage:
    def __init__(self, class_names):
        self.object_names_by_index = dict(enumerate(class_names, start=1))

    def object_name(self, index):
        return None if index == 0 else self.object_names_by_index[index]


class SyntheticClassPackages:
    def __init__(self, parents_by_class):
        self.package = SyntheticClassPackage(parents_by_class)
        self.items_by_reference = {}
        for class_name, parent in parents_by_class.items():
            parent_index = next((index for index, name in self.package.object_names_by_index.items() if name == parent), 0)
            self.items_by_reference[class_name.casefold()] = {'superIndex': parent_index}

    def resolve(self, reference, expected):
        if expected != 'Class':
            raise AssertionError(expected)
        qualified_name = next(name for name in self.package.object_names_by_index.values() if name.casefold() == reference.casefold())
        return {'object': qualified_name}, self.package, self.items_by_reference[reference.casefold()]


class PackItemsByClassClosureTests(unittest.TestCase):
    def test_packs_never_reach_the_closure_limit_and_shared_parents_are_counted_once(self):
        packing = pack_items_by_class_closure(['first', 'second', 'third', 'fourth'], synthetic_closure_of, 5, 10)
        self.assertEqual([pack.items for pack in packing.packs], [('first', 'second'), ('third', 'fourth')])
        self.assertEqual(packing.packs[0].class_closure, ('Core.Object', 'Engine.Actor', 'Synthetic.first', 'Synthetic.second'))
        self.assertTrue(all(len(pack.class_closure) < 5 for pack in packing.packs))
        self.assertEqual(packing.over_limit_items, ())

    def test_an_item_whose_closure_equals_the_limit_is_returned_as_over_limit(self):
        packing = pack_items_by_class_closure(['first', 'wide', 'second'], synthetic_closure_of, 5, 10)
        self.assertEqual(packing.over_limit_items, ('wide',))
        self.assertEqual([pack.items for pack in packing.packs], [('first', 'second')])

    def test_the_item_count_limit_cuts_packs_in_the_given_order(self):
        packing = pack_items_by_class_closure(['first', 'first', 'first'], synthetic_closure_of, 96, 2)
        self.assertEqual([pack.items for pack in packing.packs], [('first', 'first'), ('first',)])

    def test_the_same_input_gives_the_same_packs(self):
        items = ['fourth', 'first', 'third', 'second', 'first']
        self.assertEqual(pack_items_by_class_closure(items, synthetic_closure_of, 6, 3), pack_items_by_class_closure(items, synthetic_closure_of, 6, 3))

    def test_limits_must_be_positive_integers(self):
        for limits in ((0, 1), (1, 0), (1.5, 1)):
            with self.subTest(limits=limits), self.assertRaisesRegex(ValueError, 'positive integers'):
                pack_items_by_class_closure(['first'], synthetic_closure_of, *limits)

    def test_the_npc_batch_class_limit_is_the_imported_effect_bundle_limit(self):
        self.assertIs(npc_batch.MAX_CLASSES, native_effect_bundle.MAX_CLASSES)


class NativeClassClosureTests(unittest.TestCase):
    def test_the_closure_is_the_class_and_its_superclass_chain_sorted(self):
        packages = SyntheticClassPackages({'Synthetic.monster': 'Engine.Pawn', 'Engine.Pawn': 'Engine.Actor', 'Engine.Actor': 'Core.Object',
                                           'Core.Object': None})
        self.assertEqual(native_class_closure(packages, 'synthetic.MONSTER'),
                         ('Core.Object', 'Engine.Actor', 'Engine.Pawn', 'Synthetic.monster'))

    def test_a_cyclic_superclass_chain_is_refused(self):
        packages = SyntheticClassPackages({'Synthetic.first': 'Synthetic.second', 'Synthetic.second': 'Synthetic.first'})
        with self.assertRaisesRegex(FormatError, 'Cyclic native class inheritance'):
            native_class_closure(packages, 'Synthetic.first')


if __name__ == '__main__':
    unittest.main()
