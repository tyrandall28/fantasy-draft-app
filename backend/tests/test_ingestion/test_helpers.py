"""Tests for safe type conversion helpers."""
import math
from datetime import date

from rankings_ingester.ingest_stats import safe_int, safe_float, safe_str, safe_date


class TestSafeInt:
    def test_normal_int(self):
        assert safe_int(42) == 42

    def test_float_value(self):
        assert safe_int(3.7) == 3

    def test_string_number(self):
        assert safe_int("10") == 10

    def test_none(self):
        assert safe_int(None) is None

    def test_nan(self):
        assert safe_int(float("nan")) is None

    def test_invalid_string(self):
        assert safe_int("abc") is None

    def test_zero(self):
        assert safe_int(0) == 0

    def test_negative(self):
        assert safe_int(-5) == -5


class TestSafeFloat:
    def test_normal_float(self):
        assert safe_float(3.14) == 3.14

    def test_int_value(self):
        assert safe_float(42) == 42.0

    def test_string_number(self):
        assert safe_float("2.5") == 2.5

    def test_none(self):
        assert safe_float(None) is None

    def test_nan(self):
        assert safe_float(float("nan")) is None

    def test_rounds_to_2_decimals(self):
        assert safe_float(3.14159) == 3.14

    def test_invalid_string(self):
        assert safe_float("abc") is None

    def test_zero(self):
        assert safe_float(0) == 0.0


class TestSafeStr:
    def test_normal_string(self):
        assert safe_str("hello") == "hello"

    def test_none(self):
        assert safe_str(None) is None

    def test_none_string(self):
        assert safe_str("None") is None

    def test_null_string(self):
        assert safe_str("null") is None

    def test_nan_string(self):
        assert safe_str("nan") is None

    def test_empty_string(self):
        assert safe_str("") is None

    def test_number_to_string(self):
        assert safe_str(42) == "42"


class TestSafeDate:
    def test_valid_iso_date(self):
        assert safe_date("2002-05-25") == date(2002, 5, 25)

    def test_none(self):
        assert safe_date(None) is None

    def test_invalid_format(self):
        assert safe_date("not-a-date") is None

    def test_nan(self):
        assert safe_date("nan") is None

    def test_none_string(self):
        assert safe_date("None") is None
