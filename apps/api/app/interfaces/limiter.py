"""Rate limiter global (slowapi) para Synckre Agent V2.

Se define en un módulo propio para poder decorar endpoints de distintos routers
sin crear imports circulares con `main.py`.
"""

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
