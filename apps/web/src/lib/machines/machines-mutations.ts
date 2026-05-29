import { useMutation } from '@tanstack/react-query'
import { queryClient } from '../query-client.ts'
import { createComputer, startComputer, stopComputer } from './machines-api.ts'
import { machinesKeys } from './machines-query.ts'

export function useCreateComputerMutation() {
  return useMutation({
    mutationFn: createComputer,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: machinesKeys.list })
    },
  })
}

export function useStartComputerMutation() {
  return useMutation({
    mutationFn: startComputer,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: machinesKeys.list })
    },
  })
}

export function useStopComputerMutation() {
  return useMutation({
    mutationFn: stopComputer,
    onSuccess: (computer) => {
      queryClient.removeQueries({
        queryKey: machinesKeys.accessSession(computer.id),
      })
      void queryClient.invalidateQueries({ queryKey: machinesKeys.list })
    },
  })
}
