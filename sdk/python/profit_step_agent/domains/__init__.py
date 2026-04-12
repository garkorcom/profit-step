"""Domain controllers — each wraps CRMClient with typed methods."""

from profit_step_agent.domains.tasks import TasksDomain
from profit_step_agent.domains.time import TimeDomain
from profit_step_agent.domains.costs import CostsDomain
from profit_step_agent.domains.events import EventsDomain
from profit_step_agent.domains.clients import ClientsDomain
from profit_step_agent.domains.projects import ProjectsDomain
from profit_step_agent.domains.payroll import PayrollDomain

__all__ = [
    "TasksDomain",
    "TimeDomain",
    "CostsDomain",
    "EventsDomain",
    "ClientsDomain",
    "ProjectsDomain",
    "PayrollDomain",
]
