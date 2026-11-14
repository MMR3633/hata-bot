import pytest

pytest.importorskip("playwright")
from screen.app import search_url  # noqa: E402


@pytest.mark.parametrize("current,expected", [
    ("https://m.youtube.com/watch?v=x", "https://m.youtube.com/results?search_query=%D0%BA%D0%BE%D1%82%D0%B8%D0%BA%D0%B8+%D1%81%D0%BC%D0%B5%D1%88%D0%BD%D1%8B%D0%B5"),
    ("https://rutube.ru/", "https://rutube.ru/search/?query=%D0%BA%D0%BE%D1%82%D0%B8%D0%BA%D0%B8+%D1%81%D0%BC%D0%B5%D1%88%D0%BD%D1%8B%D0%B5"),
    ("https://example.com/", "https://duckduckgo.com/?q=%D0%BA%D0%BE%D1%82%D0%B8%D0%BA%D0%B8+%D1%81%D0%BC%D0%B5%D1%88%D0%BD%D1%8B%D0%B5&kl=ru-ru"),
])
def test_search_where_you_are(current, expected):
    assert search_url("котики смешные", current) == expected
