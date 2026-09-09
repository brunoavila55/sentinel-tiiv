import pytest

from app.models.enums import AssetStatus
from app.services.state_policy import evaluate_state


def _eval(previous, success, *, latency_ms=1.0, threshold=None, successes=0, failures=0):
    return evaluate_state(
        previous_status=previous,
        success=success,
        latency_ms=latency_ms,
        latency_warning_threshold_ms=threshold,
        consecutive_successes=successes,
        consecutive_failures=failures,
    )


def test_first_successful_check_from_unknown_goes_up() -> None:
    result = _eval(AssetStatus.UNKNOWN, True)
    assert result.status == AssetStatus.UP
    assert result.consecutive_successes == 1
    assert result.consecutive_failures == 0


def test_single_failure_is_warning_not_down() -> None:
    """Requisito explícito: não vira DOWN na primeira perda isolada."""
    result = _eval(AssetStatus.UP, False)
    assert result.status == AssetStatus.WARNING
    assert result.consecutive_failures == 1


def test_second_consecutive_failure_still_warning() -> None:
    result = _eval(AssetStatus.WARNING, False, failures=1)
    assert result.status == AssetStatus.WARNING
    assert result.consecutive_failures == 2


def test_third_consecutive_failure_marks_down() -> None:
    result = _eval(AssetStatus.WARNING, False, failures=2)
    assert result.status == AssetStatus.DOWN
    assert result.consecutive_failures == 3


def test_single_success_after_down_does_not_recover_immediately() -> None:
    result = _eval(AssetStatus.DOWN, True, successes=0)
    assert result.status == AssetStatus.DOWN
    assert result.consecutive_successes == 1


def test_two_consecutive_successes_after_down_recovers_to_up() -> None:
    result = _eval(AssetStatus.DOWN, True, successes=1)
    assert result.status == AssetStatus.UP
    assert result.consecutive_successes == 2


def test_success_resets_failure_counter() -> None:
    result = _eval(AssetStatus.WARNING, True, failures=2)
    assert result.consecutive_failures == 0
    assert result.status == AssetStatus.UP


def test_high_latency_triggers_warning_even_on_success() -> None:
    result = _eval(AssetStatus.UP, True, latency_ms=500.0, threshold=100.0)
    assert result.status == AssetStatus.WARNING
    # sucesso continua contando como sucesso pro contador, mesmo em warning.
    assert result.consecutive_successes == 1


def test_latency_within_threshold_stays_up() -> None:
    result = _eval(AssetStatus.UP, True, latency_ms=50.0, threshold=100.0)
    assert result.status == AssetStatus.UP


def test_no_threshold_configured_ignores_latency() -> None:
    result = _eval(AssetStatus.UP, True, latency_ms=5000.0, threshold=None)
    assert result.status == AssetStatus.UP


@pytest.mark.parametrize("previous", list(AssetStatus))
def test_three_failures_always_mark_down_regardless_of_previous_status(previous: AssetStatus) -> None:
    result = _eval(previous, False, failures=2)
    assert result.status == AssetStatus.DOWN
