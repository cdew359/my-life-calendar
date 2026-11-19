import unittest, importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "guard", Path(__file__).parents[1] / "deploy/pressure-guard.py"
)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
running = {"State": {"Status": "running", "ExitCode": 0, "OOMKilled": False}}


class PressureGuardTests(unittest.TestCase):
    def test_shared_database_is_never_in_stop_targets(self):
        """验证内存保护的停止目标不包含共享 MySQL。"""
        self.assertNotIn("mysql", guard.BUSINESS_SERVICES)
        self.assertEqual(
            set(guard.BUSINESS_SERVICES),
            {"gateway", "user-service", "calendar-service", "diary-service", "nacos", "redis"},
        )

    def test_transient_pressure_does_not_stop_and_recovers(self):
        """验证单次压力不触发停止，资源恢复后清零连续计数。"""
        self.assertEqual(guard.evaluate(80 * 1024, 900 * 1024, 1, 0, [running]), (1, None))
        self.assertEqual(guard.evaluate(200 * 1024, 900 * 1024, 1, 1, [running]), (0, None))

    def test_sustained_pressure_stops_trial(self):
        """验证连续三次资源不足会停止 Cloud 试运行栈。"""
        self.assertEqual(
            guard.evaluate(80 * 1024, 900 * 1024, 1, 2, [running]), (3, "sustained memory pressure")
        )

    def test_oom_or_failed_process_stops_trial(self):
        """验证容器异常退出或内存溢出时触发保护。"""
        bad = {"State": {"Status": "exited", "ExitCode": 1, "OOMKilled": False}}
        self.assertEqual(
            guard.evaluate(500 * 1024, 900 * 1024, 1, 0, [running, bad])[1], "container failure/OOM"
        )

    def test_normal_java_shutdown_does_not_trigger_failure(self):
        """验证 Java 正常终止不会被误判为容器故障。"""
        stopped = {"State": {"Status": "exited", "ExitCode": 143, "OOMKilled": False}}
        self.assertEqual(
            guard.evaluate(500 * 1024, 900 * 1024, 1, 0, [running, stopped]), (0, None)
        )

    def test_does_not_repeatedly_stop_an_inactive_project(self):
        """验证已停止的项目不会反复执行停止操作。"""
        bad = {"State": {"Status": "exited", "ExitCode": 137, "OOMKilled": True}}
        self.assertIsNone(guard.evaluate(80 * 1024, 900 * 1024, 50, 3, [bad])[1])


if __name__ == "__main__":
    unittest.main()
