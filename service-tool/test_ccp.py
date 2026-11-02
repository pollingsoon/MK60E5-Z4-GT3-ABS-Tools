#!/usr/bin/env python3
"""Dump logic against the mock CCP slave: python3 service-tool/test_ccp.py"""
import os
import tempfile
import threading
import unittest
from unittest import mock

import ccp


class Stop:
    """Cancel partway through: the dump checks this once per read."""

    def __init__(self):
        self.hits = 0

    def is_set(self):
        self.hits += 1
        return self.hits > 300


class DumpTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.join(self.tmp.name, "d.bin")
        self.image = bytes((i * 7 + (i >> 8)) & 0xFF for i in range(0x1000))
        self.bus = ccp.MockCcpBus(image=self.image)
        self.client = ccp.CcpClient(self.bus, timeout=0.05)

    def expected(self, n=0x1000):
        e = bytearray(self.image)
        e[0x2F8:0x300] = b"\xFF" * 8
        return bytes(e[:n])

    def read(self):
        with open(self.path, "rb") as f:
            return f.read()

    def test_reads_region_and_leaves_skip_as_ff(self):
        r = ccp.dump_region(self.client, 0, 0x1000, self.path)
        self.assertEqual(r["state"], "done")
        self.assertEqual(self.read(), self.expected())
        self.assertFalse(os.path.exists(self.path + ".progress.json"))

    def test_cancel_then_resume_gives_the_same_file(self):
        r = ccp.dump_region(self.client, 0, 0x1000, self.path, cancel=Stop())
        self.assertEqual(r["state"], "cancelled")
        self.assertTrue(0 < r["next"] < 0x1000)
        self.assertTrue(os.path.exists(self.path + ".progress.json"))
        r = ccp.dump_region(self.client, 0, 0x1000, self.path)
        self.assertEqual(r["state"], "done")
        self.assertEqual(self.read(), self.expected())

    def test_finished_dump_is_not_overwritten_without_fresh(self):
        ccp.dump_region(self.client, 0, 0x100, self.path)
        with self.assertRaises(ccp.CcpError):
            ccp.dump_region(self.client, 0, 0x100, self.path)
        ccp.dump_region(self.client, 0, 0x100, self.path, fresh=True)

    def test_resume_refuses_a_different_range(self):
        ccp.dump_region(self.client, 0, 0x1000, self.path, cancel=Stop())
        with self.assertRaises(ccp.CcpError):
            ccp.dump_region(self.client, 0, 0x800, self.path)

    def test_silent_module_keeps_the_earlier_dump(self):
        ccp.dump_region(self.client, 0, 0x100, self.path)
        before = self.read()
        self.bus.enabled = lambda: False
        with self.assertRaises(ccp.CcpError):
            ccp.dump_region(self.client, 0, 0x100, self.path, fresh=True)
        self.assertEqual(self.read(), before)

    def test_enable_callback_runs_when_connect_is_unanswered(self):
        on = threading.Event()
        self.bus.enabled = on.is_set
        r = ccp.dump_region(self.client, 0, 0x100, self.path, enable=on.set)
        self.assertEqual(r["state"], "done")
        self.assertTrue(on.is_set())

    def test_dropped_read_is_retried(self):
        self.bus.silent_reads = 1
        r = ccp.dump_region(self.client, 0, 0x100, self.path)
        self.assertEqual(r["state"], "done")
        self.assertEqual(self.read(), self.expected(0x100))

    def test_read_fault_reports_address_and_resumes(self):
        with self.assertRaisesRegex(ccp.CcpError, "0x000002F8"):
            ccp.dump_region(self.client, 0, 0x400, self.path, skips=[])
        r = ccp.dump_region(self.client, 0, 0x400, self.path)
        self.assertEqual(r["state"], "done")
        self.assertEqual(self.read(), self.expected(0x400))

    def test_reconnecting_never_reaches_the_session_read_limit(self):
        ccp.dump_region(self.client, 0, 0x1000, self.path)
        self.assertEqual(self.bus.session_errors, 0)
        self.assertEqual(self.read(), self.expected())

    def test_session_read_limit_is_recovered_if_it_is_hit(self):
        with mock.patch.object(ccp, "RECONNECT_READS", 10_000):
            r = ccp.dump_region(self.client, 0, 0x1000, self.path)
        self.assertEqual(r["state"], "done")
        self.assertGreater(self.bus.session_errors, 0)
        self.assertEqual(self.read(), self.expected())

    def test_region_ending_inside_a_skip(self):
        ccp.dump_region(self.client, 0x2F0, 0xA, self.path)
        self.assertEqual(self.read(), self.image[0x2F0:0x2F8] + b"\xFF\xFF")


if __name__ == "__main__":
    unittest.main()
