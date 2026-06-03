import { useMutation } from '@tanstack/react-query';
import { queryClient } from '../query-client';
import { createComputer, startComputer, stopComputer } from './machines-api';
import type { CloudComputer } from './machines-api';
import { upsertComputerInList } from './machines-cache';
import { machinesKeys } from './machines-query';

export function useCreateComputerMutation() {
  return useMutation({
    mutationFn: createComputer,
    onSuccess: (computer) => {
      queryClient.setQueryData<CloudComputer[]>(machinesKeys.list, (computers) =>
        upsertComputerInList(computers, computer),
      );
      void queryClient.invalidateQueries({ queryKey: machinesKeys.list });
    },
  });
}

export function useStartComputerMutation() {
  return useMutation({
    mutationFn: startComputer,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: machinesKeys.list });
    },
  });
}

export function useStopComputerMutation() {
  return useMutation({
    mutationFn: stopComputer,
    onSuccess: (computer) => {
      queryClient.removeQueries({
        queryKey: machinesKeys.accessSession(computer.id),
      });
      void queryClient.invalidateQueries({ queryKey: machinesKeys.list });
    },
  });
}
